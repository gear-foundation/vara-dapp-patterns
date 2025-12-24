use factory_client::factory::events::FactoryEvents;
use factory_client::{FactoryClient, FactoryClientCtors, factory::*};
use sails_rs::futures::StreamExt;
use sails_rs::gtest::constants::{DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE, UNITS};
use sails_rs::{client::*, gtest::*};

#[tokio::test]
async fn check_factory() {
    // Initialize an in-memory Gear test system (gtest runtime).
    let system = System::new();

    // Enable logs to simplify debugging of program creation and message flow.
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");

    // Fund the test user (Alice) so she can deploy programs and attach value to calls.
    system.mint_to(DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE);

    // Upload WASM code blobs and obtain CodeId for each program:
    // - factory program (spawns instances)
    // - child template program (spawned by the factory)
    let factory_program_code_id = system.submit_code(factory::WASM_BINARY);
    let child_program_code_id = system.submit_code(factory_child::WASM_BINARY);

    // Create a client environment with Alice as the default caller.
    let env = GtestEnv::new(system, DEFAULT_USER_ALICE.into());

    // Deploy the factory program instance:
    // - `deploy(..., salt)` deploys the program from CodeId with a given salt
    // - `.new(child_code_id)` calls the constructor, storing the child template CodeId in factory state
    let program = env
        .deploy::<factory_client::FactoryClientProgram>(factory_program_code_id, b"salt".to_vec())
        .new(child_program_code_id)
        .await
        .unwrap();

    // Obtain a typed client for the `factory` service.
    let mut factory_client = program.factory();

    // Subscribe to factory events to assert that ProgramCreated is emitted.
    let factory_listener = factory_client.listener();
    let mut factory_events = factory_listener.listen().await.unwrap();

    // Call factory.create_program().
    // We attach 1 VARA (1 * UNITS) because the created program must receive an initial balance
    // to become active on deployment.
    let result = factory_client
        .create_program()
        .with_value(1 * UNITS)
        .await
        .unwrap();

    // Read the next emitted event and verify it matches the returned address.
    let event = factory_events.next().await.unwrap();
    assert_eq!(event, (program.id(), FactoryEvents::ProgramCreated(result)));
}
