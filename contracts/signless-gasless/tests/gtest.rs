use sails_rs::futures::StreamExt;
use sails_rs::gtest::constants::{
    DEFAULT_USER_ALICE, DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE,
};
use sails_rs::{ActorId, Encode, client::*, gtest::*};

use rand_core::OsRng;
use schnorrkel::Keypair;

use signless_gasless_client::{
    ActionsForSession, SessionConfig, SignatureData, SignlessGaslessClient,
    SignlessGaslessClientCtors,
    session::{Session, events::SessionEvents},
    signless_gasless::*,
};

#[tokio::test]
async fn check_session_works() {
    // Initialize an in-memory Gear test runtime (gtest system).
    let system = System::new();

    // Enable logs to simplify debugging of message routing and signature verification.
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");

    // Fund Alice so she can deploy the program and send messages during the test.
    system.mint_to(DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE);

    // Upload the program WASM into the test system and obtain its CodeId.
    let program_code_id = system.submit_code(signless_gasless::WASM_BINARY);

    // Create a Sails test environment with Alice as the default caller (`msg::source()`).
    let env = GtestEnv::new(system, DEFAULT_USER_ALICE.into());

    // Session system configuration:
    // - gas used for delayed self-message that deletes sessions
    // - minimal allowed session duration
    // - ms per block used to derive expires_at_block
    let session_config = SessionConfig {
        gas_to_delete_session: 10_000_000_000,
        minimum_session_duration_ms: 180_000,
        ms_per_block: 3_000,
    };

    // Deploy the program instance and call the constructor (`new(session_config)`).
    let program = env
        .deploy::<signless_gasless_client::SignlessGaslessClientProgram>(
            program_code_id,
            b"salt".to_vec(),
        )
        .new(session_config)
        .await
        .unwrap();

    // Obtain typed clients for:
    // - the business service (counter increment with optional session)
    // - the session management service (create/delete/query sessions)
    let mut signless_gasless_client = program.signless_gasless();
    let mut session_client = program.session();

    // Subscribe to session events so we can assert that `SessionCreated` is emitted.
    let session_listener = session_client.listener();
    let mut session_events = session_listener.listen().await.unwrap();

    // Generate an ephemeral keypair used by the signature-based flow.
    // In this example, the signed payload authorizes the current caller (Alice)
    // to act for the account stored under `signature_data.key`.
    let pair: Keypair = Keypair::generate_with(OsRng);

    // Build the data that must be signed to authorize session creation.
    // NOTE: This structure is part of the session protocol; the message is wrapped in <Bytes>...</Bytes>
    // inside the session service implementation before verification.
    let data_to_sign = SignatureData {
        key: DEFAULT_USER_ALICE.into(), // caller that will be authorized by the signature
        duration: 180_000,
        allowed_actions: vec![ActionsForSession::IncreaseCounter],
    };

    // Construct the exact byte sequence expected by the verifier.
    let complete_message = [
        b"<Bytes>".to_vec(),
        data_to_sign.encode(),
        b"</Bytes>".to_vec(),
    ]
    .concat();

    // Produce a Schnorrkel signature that will be verified by the session service.
    let raw_signature = pair.sign_simple(b"substrate", &complete_message).to_bytes();

    // Convert the session public key into an ActorId (the on-chain representation).
    let key = ActorId::from(pair.public.to_bytes());

    // The session is stored under `key` and allows `IncreaseCounter`.
    let signature_data = SignatureData {
        key,
        duration: 180_000,
        allowed_actions: vec![ActionsForSession::IncreaseCounter],
    };

    // Create the session using the signature-based flow.
    // After this, Alice can call the business method with `Some(key)`,
    // and the resolved account becomes `key`.
    session_client
        .create_session(signature_data, Some(raw_signature.to_vec()))
        .await
        .unwrap();

    // Assert the session creation event was emitted by the program.
    assert_eq!(
        session_events.next().await.unwrap(),
        (program.id(), SessionEvents::SessionCreated)
    );

    // Execute the business call with session delegation enabled:
    // - The caller is Alice (env default)
    // - We pass `Some(key)` so the contract loads the session stored under `key`
    //   and resolves the business address to `key`
    let result = signless_gasless_client
        .increase_counter_with_possibility_of_sessions(Some(key))
        .await
        .unwrap();

    // The response contains the resolved account and the new counter value.
    assert_eq!(result, format!("Original address: {key}; counter: {}!", 1));
}

#[tokio::test]
async fn check_session_works_without_signature() {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");

    // Fund Alice (session owner) and Bob (session key / delegate).
    system.mint_to(DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE);
    system.mint_to(DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE);

    // Upload the program WASM and obtain its CodeId.
    let program_code_id = system.submit_code(signless_gasless::WASM_BINARY);

    // Create a test environment with Alice as the default caller (deployment + session creation).
    let env = GtestEnv::new(system, DEFAULT_USER_ALICE.into());

    let session_config = SessionConfig {
        gas_to_delete_session: 10_000_000_000,
        minimum_session_duration_ms: 180_000,
        ms_per_block: 3_000,
    };

    // Deploy the program and initialize it with session configuration.
    let program = env
        .deploy::<signless_gasless_client::SignlessGaslessClientProgram>(
            program_code_id,
            b"salt".to_vec(),
        )
        .new(session_config)
        .await
        .unwrap();

    let mut signless_gasless_client = program.signless_gasless();
    let mut session_client = program.session();

    // Subscribe to session events to assert that the session is created.
    let session_listener = session_client.listener();
    let mut session_events = session_listener.listen().await.unwrap();

    let alice: ActorId = DEFAULT_USER_ALICE.into();
    let bob: ActorId = DEFAULT_USER_BOB.into();

    // Create a session WITHOUT signature (signature == None).
    //
    // In this mode, the session is created by the message sender (Alice),
    // and `key` designates the delegate who is allowed to act on Alice's behalf (Bob),
    // restricted to the listed actions.
    let signature_data = SignatureData {
        key: bob,
        duration: 180_000,
        allowed_actions: vec![ActionsForSession::IncreaseCounter],
    };

    session_client
        .create_session(signature_data, None)
        .await
        .unwrap();

    // Confirm the SessionCreated event was emitted.
    assert_eq!(
        session_events.next().await.unwrap(),
        (program.id(), SessionEvents::SessionCreated)
    );

    // Bob performs the delegated business call on behalf of Alice:
    // - `with_actor_id(bob)` sets msg::source() for this call to Bob (the session key)
    // - `Some(alice)` tells the contract to resolve the original address via session rules
    let result = signless_gasless_client
        .increase_counter_with_possibility_of_sessions(Some(alice))
        .with_actor_id(bob)
        .await
        .unwrap();

    assert_eq!(
        result,
        format!("Original address: {alice}; counter: {}!", 1)
    );
}
