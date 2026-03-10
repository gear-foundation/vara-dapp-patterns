// Minimal pattern for delayed self-messages with version-based stale message protection.

#![no_std]
#![allow(clippy::new_without_default)]

use core::cell::RefCell;
use sails_rs::{
    collections::HashMap,
    gstd::{exec, msg},
    prelude::*,
};

const SERVICE_NAME: &str = "DelayedSelfMessage";
const EXPIRE_ACTION: &str = "Expire";
const DELAY_GAS: u64 = 5_000_000_000;

pub struct State {
    // Active and inactive locks by user.
    locks: HashMap<ActorId, Lock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Lock {
    // Whether the lock is currently active.
    pub active: bool,
    // Block when the lock may expire.
    pub expires_at: u32,
    // Bumped on every state change to invalidate stale delayed messages.
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    DelayMustBeNonZero,
    AlreadyActive,
    NotActive,
    NotSelfCall,
    ScheduleFailed,
    EmitEventFailed,
}

#[event]
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Event {
    Started {
        user: ActorId,
        version: u64,
        expires_at: u32,
    },
    Renewed {
        user: ActorId,
        version: u64,
        expires_at: u32,
    },
    Cancelled {
        user: ActorId,
        version: u64,
    },
    Expired {
        user: ActorId,
        version: u64,
    },
}

pub struct DelayedSelfMessageService<'a> {
    state: &'a RefCell<State>,
}

impl<'a> DelayedSelfMessageService<'a> {
    pub fn new(state: &'a RefCell<State>) -> Self {
        Self { state }
    }

    // Manually build a Sails request for the internal `Expire` call.
    fn encode_expire_request(user: ActorId, version: u64) -> Vec<u8> {
        let mut request = Vec::new();
        SERVICE_NAME.encode_to(&mut request);
        EXPIRE_ACTION.encode_to(&mut request);
        (user, version).encode_to(&mut request);
        request
    }

    // Schedule a delayed self-message that will try to expire the lock later.
    fn schedule_expire(&self, user: ActorId, version: u64, delay_blocks: u32) -> Result<(), Error> {
        let request = Self::encode_expire_request(user, version);

        msg::send_bytes_with_gas_delayed(exec::program_id(), request, DELAY_GAS, 0, delay_blocks)
            .map_err(|_| Error::ScheduleFailed)?;

        Ok(())
    }
}

#[sails_rs::service(events = Event)]
impl DelayedSelfMessageService<'_> {
    #[export(unwrap_result)]
    pub fn start(&mut self, delay_blocks: u32) -> Result<(), Error> {
        Self::ensure_nonzero_delay(delay_blocks)?;

        let user = msg::source();

        // Reuse the next version if this lock existed before.
        let version = {
            let state = self.state.borrow();
            match state.locks.get(&user) {
                Some(lock) if lock.active => return Err(Error::AlreadyActive),
                Some(lock) => lock.version.saturating_add(1),
                None => 1,
            }
        };

        // First schedule the delayed message, then persist the new lock.
        self.schedule_expire(user, version, delay_blocks)?;

        let expires_at = exec::block_height().saturating_add(delay_blocks);
        self.state.borrow_mut().locks.insert(
            user,
            Lock {
                active: true,
                expires_at,
                version,
            },
        );

        self.emit_event(Event::Started {
            user,
            version,
            expires_at,
        })
        .map_err(|_e| Error::EmitEventFailed)?;

        Ok(())
    }

    #[export(unwrap_result)]
    pub fn renew(&mut self, delay_blocks: u32) -> Result<(), Error> {
        Self::ensure_nonzero_delay(delay_blocks)?;

        let user = msg::source();

        // Renewal bumps the version, so old delayed messages become stale.
        let next_version = {
            let state = self.state.borrow();
            let Some(lock) = state.locks.get(&user) else {
                return Err(Error::NotActive);
            };

            if !lock.active {
                return Err(Error::NotActive);
            }

            lock.version.saturating_add(1)
        };

        self.schedule_expire(user, next_version, delay_blocks)?;

        let expires_at = exec::block_height().saturating_add(delay_blocks);

        self.state.borrow_mut().locks.insert(
            user,
            Lock {
                active: true,
                expires_at,
                version: next_version,
            },
        );

        self.emit_event(Event::Renewed {
            user,
            version: next_version,
            expires_at,
        })
        .map_err(|_e| Error::EmitEventFailed)?;

        Ok(())
    }

    #[export(unwrap_result)]
    pub fn cancel(&mut self) -> Result<(), Error> {
        let user = msg::source();

        let mut state = self.state.borrow_mut();
        let Some(lock) = state.locks.get_mut(&user) else {
            return Err(Error::NotActive);
        };

        if !lock.active {
            return Err(Error::NotActive);
        }

        // Cancelling also bumps the version to invalidate scheduled expirations.
        Self::deactivate(lock);

        self.emit_event(Event::Cancelled {
            user,
            version: lock.version,
        })
        .map_err(|_e| Error::EmitEventFailed)?;

        Ok(())
    }

    #[export(unwrap_result)]
    pub fn expire(&mut self, user: ActorId, version: u64) -> Result<(), Error> {
        // Only the program itself may execute delayed expiration.
        if msg::source() != exec::program_id() {
            return Err(Error::NotSelfCall);
        }

        let mut state = self.state.borrow_mut();
        let Some(lock) = state.locks.get_mut(&user) else {
            return Ok(());
        };

        // Ignore already inactive locks.
        if !lock.active {
            return Ok(());
        }

        // Ignore stale delayed messages from older versions.
        if lock.version != version {
            return Ok(());
        }

        // Extra safety check in case the message arrives too early.
        if exec::block_height() < lock.expires_at {
            return Ok(());
        }

        Self::deactivate(lock);

        self.emit_event(Event::Expired {
            user,
            version: lock.version,
        })
        .map_err(|_e| Error::EmitEventFailed)?;

        Ok(())
    }

    #[export]
    pub fn get_lock(&self, user: ActorId) -> Option<Lock> {
        self.state.borrow().locks.get(&user).cloned()
    }

    // Reject zero-delay scheduling in this pattern.
    fn ensure_nonzero_delay(delay_blocks: u32) -> Result<(), Error> {
        if delay_blocks == 0 {
            return Err(Error::DelayMustBeNonZero);
        }
        Ok(())
    }

    // Deactivate the lock and invalidate older delayed messages.
    fn deactivate(lock: &mut Lock) {
        lock.active = false;
        lock.version = lock.version.saturating_add(1);
    }
}

pub struct DelayedSelfMessageProgram {
    state: RefCell<State>,
}

#[sails_rs::program]
impl DelayedSelfMessageProgram {
    pub fn new() -> Self {
        Self {
            state: RefCell::new(State {
                locks: HashMap::new(),
            }),
        }
    }

    #[export(route = "DelayedSelfMessage")]
    pub fn delayed_self_message(&self) -> DelayedSelfMessageService<'_> {
        DelayedSelfMessageService::new(&self.state)
    }
}
