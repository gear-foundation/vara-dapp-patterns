#![no_std]

use ::gstd::prog::ProgramGenerator;
use sails_rs::{cell::RefCell, prelude::*};

/// Currently the factory only needs one piece of state:
/// - `code_id`: the code hash/id of the child program template that the factory will instantiate.
struct Storage {
    code_id: CodeId,
}

struct FactoryService<'a> {
    storage: &'a RefCell<Storage>,
}

impl<'a> FactoryService<'a> {
    /// Create a service instance bound to the program storage
    pub fn new(storage: &'a RefCell<Storage>) -> Self {
        Self { storage }
    }

    /// Read-only access to storage via RefCell borrow.
    fn get(&self) -> core::cell::Ref<'_, Storage> {
        self.storage.borrow()
    }
}

#[derive(Debug)]
pub enum FactoryError {
    /// Failed to start child program creation (error returned immediately by ProgramGenerator).
    CreateProgramStartFailed,
    /// Failed while waiting for the child program initialization reply.
    CreateProgramReplyFailed,
    /// Failed to emit the event after successful creation.
    EmitEventFailed,
}

#[event]
#[derive(Debug, Clone, Encode, Decode, TypeInfo, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum FactoryEvents {
    /// Emitted when a new child program instance is successfully created.
    /// Contains the newly created program's ActorId (address).
    ProgramCreated(ActorId),
}

#[sails_rs::service(events = FactoryEvents)]
impl<'a> FactoryService<'a> {
    #[export(unwrap_result)]
    pub async fn create_program(&mut self) -> Result<ActorId, FactoryError> {
        let code_id = { self.get().code_id };

        // Child program initialization payload
        let payload = ["New".encode(), ().encode()].concat();

        let create_program_future = ProgramGenerator::create_program_bytes_with_gas_for_reply(
            code_id,
            payload,
            10_000_000_000, // gas_limit: create + init
            0,              // value: transferred to child
            10_000_000_000, // reply_deposit: receive reply
        )
        .map_err(|_e| FactoryError::CreateProgramStartFailed)?;

        // Await the end-to-end completion (child created + initialized + replied)
        let (address, _reply_bytes) = create_program_future
            .await
            .map_err(|_e| FactoryError::CreateProgramReplyFailed)?;

        // Emit an event so off-chain clients can track created instances
        self.emit_event(FactoryEvents::ProgramCreated(address))
            .map_err(|_e| FactoryError::EmitEventFailed)?;

        Ok(address)
    }
}

pub struct FactoryProgram {
    storage: RefCell<Storage>,
}

#[sails_rs::program]
impl FactoryProgram {
    pub fn new(code_id: CodeId) -> Self {
        Self {
            storage: RefCell::new(Storage { code_id }),
        }
    }

    pub fn factory(&self) -> FactoryService<'_> {
        FactoryService::new(&self.storage)
    }
}
