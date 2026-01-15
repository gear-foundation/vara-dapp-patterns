use crate::services::admin::{Service, ServiceExposure};
use sails_rs::gstd::msg;
use sails_rs::{cell::RefCell, prelude::*};

// Example: price is integer-scaled (e.g. 1e8, 1e18 — choose one and document it).
const PRICE_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

#[derive(Debug)]
pub enum MarketError {
    OraclePriceIsZero,
    SlippageExceeded,
}

/// Market state is independent from the admin_oracle storage.
pub struct MarketStorage {
    pub last_quote_usd: u128,
    pub last_trader: ActorId,
}

impl Default for MarketStorage {
    fn default() -> Self {
        Self {
            last_quote_usd: 0,
            last_trader: ActorId::zero(),
        }
    }
}

/// Service that *depends on* Service and calls it internally.
///
/// This demonstrates service composition: Market uses Oracle as a dependency,
/// but maintains its own independent storage.
pub struct MarketService<'a> {
    admin_oracle: ServiceExposure<Service<'a>>,
    market: &'a RefCell<MarketStorage>,
}

impl<'a> MarketService<'a> {
    pub fn new(
        admin_oracle: ServiceExposure<Service<'a>>,
        market: &'a RefCell<MarketStorage>,
    ) -> Self {
        Self {
            admin_oracle,
            market,
        }
    }

    fn market_mut(&self) -> core::cell::RefMut<'_, MarketStorage> {
        self.market.borrow_mut()
    }
}

#[sails_rs::service]
impl<'a> MarketService<'a> {
    /// Pure quote based on the admin_oracle price.
    /// This is a typical “read path” that depends on admin_oracle but does not mutate admin_oracle state.
    #[export(unwrap_result)]
    pub fn quote_usd(&self, amount_tokens: u128) -> Result<u128, MarketError> {
        // Cross-service call: Market -> Oracle
        let price = self.admin_oracle.oracle.get_price();

        if *price == 0 {
            return Err(MarketError::OraclePriceIsZero);
        }

        // amount_tokens * price / PRICE_SCALE
        Ok(amount_tokens.saturating_mul(*price) / PRICE_SCALE)
    }

    /// A command that uses the admin_oracle price and applies a slippage guard.
    ///
    /// In real protocols, similar checks protect users from stale/attacked admin_oracle prices.
    #[export(unwrap_result)]
    pub fn open_position(
        &mut self,
        amount_tokens: u128,
        max_acceptable_price: u128,
    ) -> Result<u128, MarketError> {
        // Cross-service call: Market -> Oracle
        let price = self.admin_oracle.oracle.get_price();

        if *price == 0 {
            return Err(MarketError::OraclePriceIsZero);
        }
        if *price > max_acceptable_price {
            return Err(MarketError::SlippageExceeded);
        }

        let quote = amount_tokens.saturating_mul(*price) / PRICE_SCALE;

        // Persist some market-level state (independent from admin_oracle).
        let mut m = self.market_mut();
        m.last_quote_usd = quote;
        m.last_trader = msg::source();

        Ok(quote)
    }

    /// Query the last stored quote (shows that Market has its own state).
    #[export]
    pub fn last_quote(&self) -> (u128, ActorId) {
        let m = self.market.borrow();
        (m.last_quote_usd, m.last_trader)
    }
}
