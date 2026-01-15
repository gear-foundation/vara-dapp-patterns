#![no_std]
#![allow(clippy::new_without_default)]

use oracle::OracleService;
use sails_rs::gstd::msg;
use sails_rs::{cell::RefCell, prelude::*};

mod services;
use services::admin::Service;
use services::market::{MarketService, MarketStorage};

pub struct Program {
    oracle: RefCell<u128>,
    market: RefCell<MarketStorage>,
    admin: ActorId,
}

#[sails_rs::program]
impl Program {
    pub fn new() -> Self {
        Self {
            oracle: RefCell::new(0),
            market: RefCell::new(MarketStorage::default()),
            admin: msg::source(),
        }
    }

    // Guarded oracle updates (ваш admin wrapper сервис).
    pub fn admin_oracle(&self) -> Service<'_> {
        Service::new(OracleService::new(&self.oracle), self.admin)
    }

    // Market service that *uses* oracle internally.
    pub fn market(&self) -> MarketService<'_> {
        MarketService::new(self.admin_oracle(), &self.market)
    }
}
