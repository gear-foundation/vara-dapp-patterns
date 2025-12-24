#![no_std]

use sails_rs::prelude::*;

struct FactoryChild(());

impl FactoryChild {
    pub fn new() -> Self {
        Self(())
    }
}

#[sails_rs::service]
impl FactoryChild {
    // Service's method (command)
    #[export]
    pub fn do_something(&mut self) -> String {
        "Hello from FactoryChild!".to_string()
    }
}

#[derive(Default)]
pub struct Program(());

#[sails_rs::program]
impl Program {
    // Program's constructor
    pub fn new() -> Self {
        Self(())
    }

    // Exposed service
    pub fn factory_child(&self) -> FactoryChild {
        FactoryChild::new()
    }
}
