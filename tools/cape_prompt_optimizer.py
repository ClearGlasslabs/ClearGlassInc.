"""
ClearGlass Adaptive Prompt Evolution (CAPE) -- OpenAI Edition
================================================================
Self-mutating prompt optimizer wired to the OpenAI API. Lives at
tools/cape_prompt_optimizer.py alongside tools/visual_injector.py.

Design lineage:
  - Promptbreeder (arXiv:2309.16797): co-evolves task-prompts AND the
    mutation-prompts that rewrite them ("hypermutation").
  - OPRO (arXiv:2309.03409): feeds (prompt, score) trajectory back into
    the LLM as optimization context.
  - EvoPrompt (arXiv:2309.08532): GA/DE-style crossover on discrete,
    human-readable prompt genomes.
  - MIPRO / GEPA (DSPy, arXiv:2406.11695): Pareto multi-objective
    retention + bandit/surrogate-guided sampling to bound LLM-call cost.

CAPE combines all of the above: it self-mutates at two levels (prompts
AND the operators that mutate them) while capping total OpenAI calls to
a fixed budget via UCB1 bandit allocation, and selects survivors on a
Pareto front of accuracy, cost, and variance instead of a single score.

USAGE
-----
    export OPENAI_API_KEY=sk-...
    python tools/cape_prompt_optimizer.py \
        --task "Classify the sentiment of a product review as positive, negative, or neutral. Respond with one word only." \
        --seed-prompt "Classify sentiment: {input}" \
        --seed-prompt "Read the review and output positive, negative, or neutral for its sentiment: {input}" \
        --test-input "This product exceeded every expectation I had." \
        --test-input "Complete waste of money, broke on day two." \
        --test-input "It's fine, does what it says, nothing special." \
        --generations 6 --pop-size 8 --eval-budget 120

Swap `evaluate_with_judge` for a real benchmark (exact-match accuracy,
unit tests, retrieval metrics, etc.) whenever ground truth is available;
the LLM-judge fallback here is a general-purpose default so the
optimizer works on any task out of the box.
"""

import argparse
import math
import os
import random
import statistics
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple

from openai import OpenAI

MUTATION_MODEL = os.environ.get("CAPE_MUTATION_MODEL", "gpt-4o-mini")
JUDGE_MODEL = os.environ.get("CAPE_JUDGE_MODEL", "gpt-4o-mini")
TARGET_MODEL = os.environ.get("CAPE_TARGET_MODEL", "gpt-4o-mini")

_client: Optional[OpenAI] = None


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


@dataclass
class Genome:
    task_prompt: str
    mutation_prompt: str
    lineage: List[str] = field(default_factory=list)
    scores: List[float] = field(default_factory=list)
    cost: float = 0.0
    n_evals: int = 0

    @property
    def mean_score(self) -> float:
        return statistics.mean(self.scores) if self.scores else 0.0

    @property
    def var_score(self) -> float:
        return statistics.pstdev(self.scores) if len(self.scores) > 1 else 0.0


def _chat(model: str, system: str, user: str, temperature: float = 0.9) -> Tuple[str, float]:
    resp = client().chat.completions.create(
        model=model,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    text = resp.choices[0].message.content.strip()
    usage = resp.usage
    cost_tokens = float((usage.prompt_tokens or 0) + (usage.completion_tokens or 0)) if usage else 0.0
    return text, cost_tokens


def openai_llm_mutate(kind: str, **kw) -> str:
    """Hypermutation and crossover-mutation via OpenAI, both self-referential."""
    if kind == "hypermutate":
        system = ("You rewrite MUTATION INSTRUCTIONS used to evolve prompts. "
                   "Given a mutation-instruction, produce a new, more effective "
                   "one-line mutation-instruction. Output only the new instruction.")
        user = f"Current mutation-instruction: {kw['mutation_prompt']}"
        text, _ = _chat(MUTATION_MODEL, system, user, temperature=1.0)
        return text

    trajectory = kw.get("trajectory", [])
    traj_text = "\n".join(f"gen {g}: score={s} :: {p}" for g, p, s in trajectory) or "none yet"
    system = ("You are an expert prompt engineer performing evolutionary prompt "
               "optimization. Combine ideas from two parent prompts using the given "
               "mutation-instruction, informed by the optimization trajectory so far. "
               "Output ONLY the new candidate prompt text, no commentary.")
    user = (f"Parent prompt A: {kw['task_prompt_a']}\n\n"
            f"Parent prompt B: {kw['task_prompt_b']}\n\n"
            f"Mutation instruction: {kw['mutation_prompt']}\n\n"
            f"Recent optimization trajectory (generation: score :: prompt prefix):\n{traj_text}\n\n"
            "Produce one improved child prompt.")
    text, _ = _chat(MUTATION_MODEL, system, user, temperature=0.9)
    return text


def make_openai_evaluator(task_description: str, test_inputs: List[str],
                           rubric: Optional[str] = None) -> Callable[[str], Tuple[float, float]]:
    """Builds an evaluator that runs a candidate prompt against test_inputs on
    TARGET_MODEL, then scores outputs with an LLM judge (0-1) unless you swap
    this for exact-match / unit-test scoring against ground truth."""
    rubric = rubric or (
        "Score how well the OUTPUT accomplishes the TASK for the given INPUT, "
        "on a 0.0-1.0 scale (1.0 = perfect). Reply with only the number."
    )

    def evaluate(task_prompt: str) -> Tuple[float, float]:
        scores = []
        total_tokens = 0.0
        for test_input in test_inputs:
            filled = task_prompt.replace("{input}", test_input) if "{input}" in task_prompt \
                else f"{task_prompt}\n\nInput: {test_input}"
            output, run_tokens = _chat(TARGET_MODEL, "You follow the instruction exactly.",
                                        filled, temperature=0.0)
            total_tokens += run_tokens

            judge_user = (f"TASK: {task_description}\nINPUT: {test_input}\n"
                           f"OUTPUT: {output}\n\n{rubric}")
            judge_reply, judge_tokens = _chat(JUDGE_MODEL, "You are a strict, consistent grader.",
                                               judge_user, temperature=0.0)
            total_tokens += judge_tokens
            try:
                scores.append(max(0.0, min(1.0, float(judge_reply.split()[0]))))
            except ValueError:
                scores.append(0.0)

        cost = total_tokens * 0.0000006  # approx blended $/token, adjust to your pricing
        return (statistics.mean(scores) if scores else 0.0), cost

    return evaluate


class ClearGlassAPE:
    """Self-mutating, budget-bounded prompt optimizer. See module docstring
    for the four research lineages this synthesizes and why."""

    def __init__(self, llm_mutate: Callable, llm_evaluate: Callable,
                 pop_size: int = 8, generations: int = 6, eval_budget: int = 120,
                 elite_frac: float = 0.25, early_stop_patience: int = 3):
        self.llm_mutate = llm_mutate
        self.llm_evaluate = llm_evaluate
        self.pop_size = pop_size
        self.generations = generations
        self.eval_budget = eval_budget
        self.elite_frac = elite_frac
        self.early_stop_patience = early_stop_patience
        self.total_calls = 0
        self.history: List[Tuple[int, str, float]] = []

    def initialize(self, seed_prompts: List[str], seed_mutation_prompts: List[str]) -> List[Genome]:
        pop = []
        for i in range(self.pop_size):
            tp = seed_prompts[i % len(seed_prompts)]
            mp = seed_mutation_prompts[i % len(seed_mutation_prompts)]
            pop.append(Genome(task_prompt=tp, mutation_prompt=mp, lineage=[f"seed_{i}"]))
        return pop

    def ucb1_allocate(self, pop: List[Genome], round_budget: int) -> None:
        for g in pop:
            if g.n_evals == 0 and round_budget > 0:
                self._score(g)
                round_budget -= 1
        total_n = sum(g.n_evals for g in pop) or 1
        while round_budget > 0:
            def ucb(g: Genome) -> float:
                return g.mean_score + math.sqrt(2 * math.log(total_n) / g.n_evals)
            target = max(pop, key=ucb)
            self._score(target)
            total_n += 1
            round_budget -= 1

    def pareto_select(self, pop: List[Genome]) -> List[Genome]:
        def dominates(a: Genome, b: Genome) -> bool:
            better_or_eq = (a.mean_score >= b.mean_score and a.cost <= b.cost and a.var_score <= b.var_score)
            strictly_better = (a.mean_score > b.mean_score or a.cost < b.cost or a.var_score < b.var_score)
            return better_or_eq and strictly_better
        front = [g for g in pop if not any(dominates(o, g) for o in pop if o is not g)]
        n_elite = max(2, int(self.pop_size * self.elite_frac))
        front_sorted = sorted(front, key=lambda g: g.mean_score, reverse=True)
        backfill = sorted(pop, key=lambda g: g.mean_score, reverse=True)
        combined = front_sorted + [g for g in backfill if g not in front_sorted]
        return combined[:n_elite]

    def hypermutate(self, elites: List[Genome]) -> List[str]:
        return [self.llm_mutate(kind="hypermutate", mutation_prompt=g.mutation_prompt) for g in elites]

    def breed(self, elites: List[Genome], new_mutation_prompts: List[str], gen: int) -> List[Genome]:
        children = []
        while len(children) < self.pop_size:
            parent_a = random.choice(elites)
            parent_b = random.choice(elites)
            mp = random.choice(new_mutation_prompts)
            child_prompt = self.llm_mutate(
                kind="crossover_mutate",
                task_prompt_a=parent_a.task_prompt,
                task_prompt_b=parent_b.task_prompt,
                mutation_prompt=mp,
                trajectory=self.history[-5:],
            )
            children.append(Genome(task_prompt=child_prompt, mutation_prompt=mp,
                                    lineage=parent_a.lineage + [f"gen{gen}"]))
        return children

    def run(self, seed_prompts: List[str], seed_mutation_prompts: List[str]) -> Genome:
        pop = self.initialize(seed_prompts, seed_mutation_prompts)
        per_gen_budget = max(1, self.eval_budget // self.generations)
        best_overall: Optional[Genome] = None
        stale_rounds = 0

        for gen in range(self.generations):
            self.ucb1_allocate(pop, per_gen_budget)
            elites = self.pareto_select(pop)
            best_gen = max(pop, key=lambda g: g.mean_score)
            self.history.append((gen, best_gen.task_prompt[:60], round(best_gen.mean_score, 4)))

            if best_overall is None or best_gen.mean_score > best_overall.mean_score:
                best_overall = best_gen
                stale_rounds = 0
            else:
                stale_rounds += 1

            print(f"[CAPE] gen {gen}: best_score={best_gen.mean_score:.4f} "
                  f"calls_used={self.total_calls}/{self.eval_budget}")

            if stale_rounds >= self.early_stop_patience:
                print(f"[CAPE] early stop at gen {gen}: no improvement for {self.early_stop_patience} rounds")
                break

            new_mutation_prompts = self.hypermutate(elites)
            pop = elites + self.breed(elites, new_mutation_prompts, gen)

        return best_overall

    def _score(self, g: Genome) -> None:
        score, cost = self.llm_evaluate(g.task_prompt)
        g.scores.append(score)
        g.cost += cost
        g.n_evals += 1
        self.total_calls += 1


def main():
    parser = argparse.ArgumentParser(description="ClearGlass Adaptive Prompt Evolution (OpenAI)")
    parser.add_argument("--task", required=True, help="Natural-language description of the task the prompt must solve")
    parser.add_argument("--seed-prompt", action="append", required=True, help="Seed task-prompt (repeatable). Use {input} as placeholder.")
    parser.add_argument("--test-input", action="append", required=True, help="Test input the prompt will be run against (repeatable)")
    parser.add_argument("--seed-mutation-prompt", action="append",
                         default=["Make it more precise and concise.",
                                  "Add a clarifying constraint.",
                                  "Rephrase for a different reasoning style."],
                         help="Seed mutation-instruction (repeatable)")
    parser.add_argument("--rubric", default=None, help="Custom scoring rubric for the LLM judge")
    parser.add_argument("--pop-size", type=int, default=8)
    parser.add_argument("--generations", type=int, default=6)
    parser.add_argument("--eval-budget", type=int, default=120)
    args = parser.parse_args()

    evaluator = make_openai_evaluator(args.task, args.test_input, args.rubric)
    optimizer = ClearGlassAPE(
        llm_mutate=openai_llm_mutate,
        llm_evaluate=evaluator,
        pop_size=args.pop_size,
        generations=args.generations,
        eval_budget=args.eval_budget,
    )
    best = optimizer.run(args.seed_prompt, args.seed_mutation_prompt)

    print("\n=== CAPE RESULT ===")
    print(f"Best prompt:\n{best.task_prompt}\n")
    print(f"Mean score: {best.mean_score:.4f}")
    print(f"Total OpenAI calls used: {optimizer.total_calls}/{optimizer.eval_budget}")
    print(f"Lineage: {' -> '.join(best.lineage)}")


if __name__ == "__main__":
    main()
