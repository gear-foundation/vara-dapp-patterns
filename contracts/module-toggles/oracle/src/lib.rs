#![no_std]

use sails_rs::{cell::RefCell, prelude::*};

/// Minimal oracle storage: stores the latest price value.
/// In a real oracle you would likely store (price, timestamp, decimals, asset_id, etc.).
pub struct OracleService<'a> {
    price: &'a RefCell<u128>,
}

impl<'a> OracleService<'a> {
    pub fn new(price: &'a RefCell<u128>) -> Self {
        Self { price }
    }
    pub fn get_mut_price(&self) -> core::cell::RefMut<'_, u128> {
        self.price.borrow_mut()
    }
    pub fn get_price(&self) -> core::cell::Ref<'_, u128> {
        self.price.borrow()
    }
}

#[sails_rs::service]
impl<'a> OracleService<'a> {
    /// Updates the stored price.
    #[export]
    pub fn update_price(&mut self, new_price: u128) {
        *self.get_mut_price() = new_price;
    }

    /// Reads the latest stored price.
    #[export]
    pub fn get_price(&self) -> u128 {
        *self.price.borrow()
    }
}
