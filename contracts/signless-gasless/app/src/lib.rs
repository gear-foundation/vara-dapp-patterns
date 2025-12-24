#![no_std]

use sails_rs::prelude::*;
use session_service::*;

/// Defines the set of actions that may be delegated via a session.
#[derive(Debug, Clone, Encode, Decode, TypeInfo, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum ActionsForSession {
    IncreaseCounter,
}

// Generates the session-management types and the `SessionService` API.
//
// The macro expands into:
// - `SessionStorage` (stores active sessions and config)
// - `SessionService` (create/delete/query sessions)
// - `SessionConfig`, `SessionData`, `SignatureData`, `SessionError`, and events
//
// Most importantly for application logic: it provides
// `SessionStorage::get_original_address(...)` which resolves the “real” caller
// when a session is used, while enforcing expiry, allowed actions, and key ownership.
generate_session_system!(ActionsForSession);

/// Application-specific storage for the demo business logic.
#[derive(Default)]
pub struct CounterStorage {
    pub counter: u64,
}

struct ServiceUsingSession<'a> {
    session_storage: &'a RefCell<SessionStorage>,
    counter_storage: &'a RefCell<CounterStorage>,
}

impl<'a> ServiceUsingSession<'a> {
    pub fn new(
        session_storage: &'a RefCell<SessionStorage>,
        counter_storage: &'a RefCell<CounterStorage>,
    ) -> Self {
        Self {
            session_storage,
            counter_storage,
        }
    }

    /// Immutable borrow of session storage
    fn get_session_storage(&self) -> core::cell::Ref<'_, SessionStorage> {
        self.session_storage.borrow()
    }
    /// Mutable borrow of the counter business state
    fn get_counter_storage_mut(&self) -> core::cell::RefMut<'_, CounterStorage> {
        self.counter_storage.borrow_mut()
    }
}

#[sails_rs::service]
impl<'a> ServiceUsingSession<'a> {
    /// Increments a counter, with optional session-based delegation
    #[export(route = "increase_counter_with_possibility_of_sessions", unwrap_result)]
    pub fn increase_counter(
        &mut self,
        session_for_account: Option<ActorId>,
    ) -> Result<String, SessionError> {
        let msg_src = msg::source();

        // Resolve the “original” account for which this call is executed
        let original_addr = {
            let storage = self.get_session_storage();
            storage.get_original_address(
                &msg_src,
                &session_for_account,
                ActionsForSession::IncreaseCounter,
            )?
        };

        // Business logic: increment the counter
        let new_value = {
            let mut c = self.get_counter_storage_mut();
            c.counter = c.counter.saturating_add(1);
            c.counter
        };

        Ok(format!(
            "Original address: {original_addr}; counter: {new_value}!"
        ))
    }
}

/// Top-level program type owning all persistent storages
pub struct Program {
    /// Storage used by the generated session system (sessions map + config)
    session_storage: RefCell<SessionStorage>,
    /// Storage used by the business logic (the demo counter)
    counter_storage: RefCell<CounterStorage>,
}

#[sails_rs::program]
impl Program {
    pub async fn new(session_config: SessionConfig) -> Self {
        Self {
            session_storage: RefCell::new(SessionStorage::new(session_config)),
            counter_storage: RefCell::new(CounterStorage::default()),
        }
    }

    pub fn signless_gasless(&self) -> ServiceUsingSession<'_> {
        ServiceUsingSession::new(&self.session_storage, &self.counter_storage)
    }

    pub fn session(&self) -> SessionService<'_> {
        SessionService::new(&self.session_storage)
    }
}
