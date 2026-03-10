use delayed_self_message_client::{
    DelayedSelfMessageClient, DelayedSelfMessageClientCtors, delayed_self_message::*,
};
use sails_rs::{
    client::*,
    gtest::{
        System,
        constants::{DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE},
    },
};

type Program = Actor<delayed_self_message_client::DelayedSelfMessageClientProgram, GtestEnv>;

struct TestEnv {
    env: GtestEnv,
    program: Program,
}

async fn setup() -> TestEnv {
    // Initialize an in-memory Gear test system.
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");

    // Fund the default caller used in tests.
    system.mint_to(DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE);

    // Upload the program WASM and get its CodeId.
    let program_code_id = system.submit_code(delayed_self_message::WASM_BINARY);

    // Create a typed gtest environment for Alice.
    let env = GtestEnv::new(system, DEFAULT_USER_ALICE.into());

    // Deploy the program instance and call its constructor.
    let program = env
        .deploy::<delayed_self_message_client::DelayedSelfMessageClientProgram>(
            program_code_id,
            b"salt".to_vec(),
        )
        .new()
        .await
        .unwrap();

    TestEnv { env, program }
}

fn advance_blocks(system: &System, n: u32) {
    for _ in 0..n {
        system.run_next_block();
    }
}

#[tokio::test]
async fn start_creates_lock_and_delayed_message_expires_it() {
    let test_env = setup().await;
    let mut client = test_env.program.delayed_self_message();

    // Start a new lock with delayed expiration.
    client.start(3).await.unwrap();

    // Read the lock right after creation.
    let lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must exist after start");

    assert!(lock.active);
    assert_eq!(lock.version, 1);

    // In gtest, every awaited call/query advances execution by one block.
    // So we check again immediately, without advancing extra blocks yet.
    let lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must still exist before expiration");

    assert!(lock.active);
    assert_eq!(lock.version, 1);

    // Advance to the expiration point and verify that the delayed self-message ran.
    advance_blocks(test_env.env.system(), 1);

    let lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock entry should still exist after expiration");

    assert!(!lock.active);
    assert_eq!(lock.version, 2);
}

#[tokio::test]
async fn cancel_invalidates_scheduled_expiration() {
    let test_env = setup().await;
    let mut client = test_env.program.delayed_self_message();

    // Start and then cancel the lock before the delayed expiration fires.
    client.start(3).await.unwrap();
    client.cancel().await.unwrap();

    let lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must exist after cancel");

    assert!(!lock.active);
    assert_eq!(lock.version, 2);

    // Let the old delayed message arrive. It must be ignored as stale.
    advance_blocks(test_env.env.system(), 4);

    let lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("stale delayed message must not change lock");

    assert!(!lock.active);
    assert_eq!(lock.version, 2);
}

#[tokio::test]
async fn renew_invalidates_old_delayed_message_and_keeps_new_one() {
    let test_env = setup().await;
    let mut client = test_env.program.delayed_self_message();

    // Start the initial lock.
    client.start(3).await.unwrap();

    let first_lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must exist after start");

    assert!(first_lock.active);
    assert_eq!(first_lock.version, 1);

    // Renew the lock with a longer delay.
    client.renew(5).await.unwrap();

    let renewed_lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must exist after renew");

    assert!(renewed_lock.active);
    assert_eq!(renewed_lock.version, 2);
    assert!(renewed_lock.expires_at > first_lock.expires_at);

    // Advance far enough for the old timer to become stale,
    // but not far enough for the renewed timer to expire.
    advance_blocks(test_env.env.system(), 2);

    let lock_after_old_timer = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must still exist after stale timer");

    assert!(lock_after_old_timer.active);
    assert_eq!(lock_after_old_timer.version, 2);

    // Advance to the new expiration point.
    advance_blocks(test_env.env.system(), 1);

    let final_lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must still exist after final expiration");

    assert!(!final_lock.active);
    assert_eq!(final_lock.version, 3);
}

#[tokio::test]
async fn expire_cannot_be_called_from_external_actor() {
    let test_env = setup().await;
    let mut client = test_env.program.delayed_self_message();

    // Create a lock first.
    client.start(3).await.unwrap();

    // `expire` is an internal entrypoint and must reject external calls.
    let result = client.expire(DEFAULT_USER_ALICE.into(), 1).await;

    assert!(result.is_err(), "external call to expire must fail");

    let lock = client
        .get_lock(DEFAULT_USER_ALICE.into())
        .await
        .unwrap()
        .expect("lock must remain unchanged after rejected external expire");

    assert!(lock.active);
    assert_eq!(lock.version, 1);
}
