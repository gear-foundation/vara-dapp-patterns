use sails_rs::gtest::constants::{
    DEFAULT_USER_ALICE, DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE,
};
use sails_rs::{ActorId, client::*, gtest::*};

use oracle_admin_wrapper_client::admin_oracle::AdminOracle;
use oracle_admin_wrapper_client::market::Market;
use oracle_admin_wrapper_client::{
    OracleAdminWrapperClient, OracleAdminWrapperClientCtors, OracleAdminWrapperClientProgram,
};

/// Must match `PRICE_SCALE` in `app/src/services/market/mod.rs`.
const PRICE_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

fn init_system_with_two_users() -> System {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");

    system.mint_to(DEFAULT_USER_ALICE, DEFAULT_USERS_INITIAL_BALANCE);
    system.mint_to(DEFAULT_USER_BOB, DEFAULT_USERS_INITIAL_BALANCE);

    system
}

async fn deploy_program_as_alice(
    system: System,
) -> Actor<OracleAdminWrapperClientProgram, GtestEnv> {
    let program_code_id = system.submit_code(oracle_admin_wrapper::WASM_BINARY);

    let env = GtestEnv::new(system, DEFAULT_USER_ALICE.into());

    env.deploy::<OracleAdminWrapperClientProgram>(program_code_id, b"salt".to_vec())
        .new()
        .await
        .unwrap()
}

#[tokio::test]
async fn admin_can_update_price_and_quote_works() {
    let system = init_system_with_two_users();

    let program = deploy_program_as_alice(system).await;

    let mut admin_oracle = program.admin_oracle();
    let market = program.market();

    // Initially oracle price is 0 -> quote must fail (unwrap_result => client receives Err).
    let err = market.quote_usd(1 * PRICE_SCALE).await;
    assert!(err.is_err(), "quote_usd must fail when oracle price == 0");

    // Admin (Alice) updates price to 2.0 USD (scaled).
    admin_oracle.update_price(2 * PRICE_SCALE).await.unwrap();

    // Public query returns the updated value.
    let price = admin_oracle.get_price().await.unwrap();
    assert_eq!(price, 2 * PRICE_SCALE);

    // amount_tokens = 3.0 tokens -> quote = 3 * 2 = 6.0 USD (scaled).
    let quote = market.quote_usd(3 * PRICE_SCALE).await.unwrap();
    assert_eq!(quote, 6 * PRICE_SCALE);
}

#[tokio::test]
async fn non_admin_cannot_update_price() {
    let system = init_system_with_two_users();
    let program = deploy_program_as_alice(system).await;

    let bob: ActorId = DEFAULT_USER_BOB.into();

    let mut admin_oracle = program.admin_oracle();

    // Bob is not an admin -> must fail.
    let res = admin_oracle.update_price(123).with_actor_id(bob).await;
    assert!(res.is_err(), "non-admin update_price must fail");

    // Price must remain unchanged (still 0).
    let price = admin_oracle.get_price().await.unwrap();
    assert_eq!(price, 0);
}

#[tokio::test]
async fn market_open_position_persists_state_and_checks_slippage() {
    let system = init_system_with_two_users();
    let program = deploy_program_as_alice(system).await;

    let alice: ActorId = DEFAULT_USER_ALICE.into();
    let bob: ActorId = DEFAULT_USER_BOB.into();

    let mut admin_oracle = program.admin_oracle();
    let mut market = program.market();

    // Set oracle price = 5.0 USD (scaled) by admin.
    let price = 5 * PRICE_SCALE;
    admin_oracle.update_price(price).await.unwrap();

    // Bob opens a position with max_acceptable_price = price -> ok.
    let amount_tokens = 4 * PRICE_SCALE;
    let quote = market
        .open_position(amount_tokens, price)
        .with_actor_id(bob)
        .await
        .unwrap();

    // quote = 4 * 5 = 20 USD (scaled).
    assert_eq!(quote, 20 * PRICE_SCALE);

    // Market state must store last quote + trader.
    let (last_quote, last_trader) = market.last_quote().await.unwrap();
    assert_eq!(last_quote, quote);
    assert_eq!(last_trader, bob);

    // Slippage guard: max_acceptable_price < current price -> must fail.
    let res = market
        .open_position(amount_tokens, price - 1)
        .with_actor_id(alice)
        .await;
    assert!(res.is_err(), "open_position must fail on slippage");

    // State must remain unchanged after the failed call.
    let (last_quote2, last_trader2) = market.last_quote().await.unwrap();
    assert_eq!(last_quote2, quote);
    assert_eq!(last_trader2, bob);
}
