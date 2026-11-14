//! tUSDC: mock NEP-141 stablecoin for the near-redteam testnet demo.
//!
//! Standard FungibleToken (NEP-141 + NEP-145 + NEP-148). Testnet only.
//! It adds a public faucet: `mint(amount)` mints up to `MINT_CAP_PER_CALL` to the caller and
//! auto-registers the caller's storage (the contract pays), so it needs a 0-deposit call.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

pub const DECIMALS: u8 = 6;
/// 1000 tUSDC per mint call.
pub const MINT_CAP_PER_CALL: u128 = 1_000 * 10u128.pow(DECIMALS as u32);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    owner_id: AccountId,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let mut token = FungibleToken::new(b"t".to_vec());
        token.internal_register_account(&owner_id);
        Self { token, owner_id }
    }

    /// Public faucet: mints `amount` (≤ 1000 tUSDC) to the caller. Registers storage if needed.
    pub fn mint(&mut self, amount: U128) -> U128 {
        let account_id = env::predecessor_account_id();
        self.internal_mint(&account_id, amount.0)
    }

    /// Owner-only: mint any amount to `account_id` (setup convenience).
    pub fn mint_to(&mut self, account_id: AccountId, amount: U128) -> U128 {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "ERR_NOT_OWNER: only owner"
        );
        require!(amount.0 > 0, "ERR_INPUT: amount must be > 0");
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount: amount,
            memo: Some("owner mint"),
        }
        .emit();
        U128(self.token.ft_balance_of(account_id).0)
    }

    fn internal_mint(&mut self, account_id: &AccountId, amount: u128) -> U128 {
        require!(amount > 0, "ERR_INPUT: amount must be > 0");
        require!(
            amount <= MINT_CAP_PER_CALL,
            "ERR_MINT_CAP: max 1000 tUSDC (1000000000) per mint call"
        );
        if !self.token.accounts.contains_key(account_id) {
            self.token.internal_register_account(account_id);
        }
        self.token.internal_deposit(account_id, amount);
        FtMint {
            owner_id: account_id,
            amount: U128(amount),
            memo: Some("faucet"),
        }
        .emit();
        self.token.ft_balance_of(account_id.clone())
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, _burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (near-redteam)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id("tusdc.testnet".parse().unwrap())
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor);
        b
    }

    #[test]
    fn faucet_mint_registers_and_credits() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Contract::new(accounts(0));
        testing_env!(ctx(accounts(1)).build());
        c.mint(U128(MINT_CAP_PER_CALL));
        c.mint(U128(5));
        assert_eq!(c.ft_balance_of(accounts(1)).0, MINT_CAP_PER_CALL + 5);
        assert_eq!(c.ft_total_supply().0, MINT_CAP_PER_CALL + 5);
        assert_eq!(c.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "ERR_MINT_CAP")]
    fn faucet_mint_is_capped() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Contract::new(accounts(0));
        testing_env!(ctx(accounts(1)).build());
        c.mint(U128(MINT_CAP_PER_CALL + 1));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn mint_to_owner_only() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Contract::new(accounts(0));
        testing_env!(ctx(accounts(1)).build());
        c.mint_to(accounts(1), U128(1));
    }

    #[test]
    fn owner_mint_to_any_amount() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Contract::new(accounts(0));
        c.mint_to(accounts(2), U128(MINT_CAP_PER_CALL * 10));
        assert_eq!(c.ft_balance_of(accounts(2)).0, MINT_CAP_PER_CALL * 10);
    }
}
