---
title: Verdicts and payouts
description: How the enclave decides a leak, and how one callback pays the attacker and seals the report.
section: Concepts
order: 10
---

> Placeholder page: the team is writing the real one in `docs/site/`.

An attack is one message, sealed for the TEE: a locked hardware enclave nobody can look into. Inside it, the enclave runs the message against the treasury agent and checks the reply for the canary, a fake secret planted so a leak can be proven.

## The verdict

- **Valid**: the canary leaked. The attacker is paid.
- **Invalid**: it didn't, or the message tried to sway the grader (that also earns a strike).
- **Failed**: the run didn't finish. An OutLayer timeout refunds 0.009 NEAR of the fee.

## The payout

One contract callback does three things at once: it records the verdict, pays the attacker (and the lead's margin in a subjob), and stores the report sealed for the owner.

### Why one callback

So nobody can see an attack before it's paid for, and no attacker can be left unpaid.
