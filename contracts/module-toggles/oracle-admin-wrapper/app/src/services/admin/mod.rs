use oracle::OracleService;
use sails_rs::gstd::msg;
use sails_rs::prelude::*;
// Typed error is preferable to String (stable ABI and smaller WASM).
#[derive(Debug)]
pub enum AdminError {
    Unauthorized,
}

/// Admin wrapper service that extends `oracle::OracleService`
/// and overrides selected methods to inject access control.
pub struct Service<'a> {
    pub(crate) oracle: OracleService<'a>,
    admin: ActorId,
}

impl<'a> Service<'a> {
    pub fn new(oracle: OracleService<'a>, admin: ActorId) -> Self {
        Self { oracle, admin }
    }

    fn ensure_admin(&self) -> Result<(), AdminError> {
        if msg::source() != self.admin {
            return Err(AdminError::Unauthorized);
        }
        Ok(())
    }
}

// Required for `extends = [OracleService<'a>]`.
// Sails needs a way to convert the extending service into the extended one.
// `From` automatically provides `Into`.
impl<'a> From<Service<'a>> for OracleService<'a> {
    fn from(s: Service<'a>) -> Self {
        s.oracle
    }
}

#[sails_rs::service(extends = [OracleService<'a>])]
impl<'a> Service<'a> {
    /// Override the base `update_price` method and enforce admin access.
    #[export(unwrap_result)]
    pub fn update_price(&mut self, value: u128) -> Result<(), AdminError> {
        self.ensure_admin()?;
        *self.oracle.get_mut_price() = value;
        Ok(())
    }
}
