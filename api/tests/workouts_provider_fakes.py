"""Explicit test-only budget injection; provider transport remains synthetic."""

from uuid import uuid4

from app.domains.workouts.budget import BudgetAttempt, BudgetError


class FakeBudget:
    def __init__(self, *, deny_at=None):
        self.deny_at = deny_at
        self.reservations = []
        self.outcomes = []

    def attempt(self, *, capability, model, envelope):
        return BudgetAttempt(self, capability, model, envelope)

    async def reserve(self, capability, model, envelope):
        self.reservations.append((capability, model, envelope))
        if len(self.reservations) == self.deny_at:
            raise BudgetError("workouts_ai_budget_exceeded")
        return uuid4(), 1

    async def finish(self, identifier, outcome, estimated_cost):
        self.outcomes.append(outcome)
