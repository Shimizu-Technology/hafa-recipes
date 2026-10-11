import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import { isISODate } from "@/lib/sharing";
import type { DietaryRecipe, RecipeContext, RecipeGrants } from "@/lib/connections";
import { Field } from "@/components/ui";
function RecipeSummary({ recipe }: { recipe: DietaryRecipe }) {
  return (
    <Card>
      <Copy kind="heading">{recipe.title}</Copy>
      <Copy>
        {recipe.servings == null ? "Servings not specified" : `${recipe.servings} recipe servings`} · Nutrition{" "}
        {recipe.nutrition_status} · Basis {recipe.nutrition_basis ?? "not specified"}
      </Copy>
      {recipe.incomplete && (
        <Notice>Source details are incomplete. Review them in Recipes before relying on estimates.</Notice>
      )}
      {recipe.ingredients.map((ingredient, index) => (
        <Copy kind="small" key={index}>
          {[ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(" ")}
        </Copy>
      ))}
      {recipe.nutrition_status === "current" &&
        Object.entries(recipe.nutrition)
          .filter(([, value]) => value != null)
          .map(([key, value]) => (
            <Copy kind="small" key={key}>
              {key} · {value}
            </Copy>
          ))}
    </Card>
  );
}
export default function RecipesConnection() {
  const { api, owner, enrollment } = useTraining();
  const generation = enrollment?.generation ?? 0;
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "recipes-grants", generation],
    queryFn: () => api.recipeGrants(generation),
    enabled: !!enrollment?.enrolled,
  });
  const [choices, setChoices] = useState<RecipeGrants | null>(null);
  const [context, setContext] = useState<RecipeContext | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setContext(null);
        void q.refetch();
      }
    });
    return () => sub.remove();
  }, [q.refetch]);
  useEffect(() => {
    if (q.data && !choices) setChoices(q.data);
  }, [q.data, choices]);
  async function save() {
    if (!choices || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setContext(null);
    try {
      const saved = await api.saveRecipeGrants(
        choices.revision,
        choices.library_context,
        choices.meal_plan_context,
        choices.generation
      );
      setChoices(saved);
      cache.setQueryData([owner, "recipes-grants", generation], saved);
      setMessage("Recipes choices saved. Your health and other app permissions were not changed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function read() {
    if (lock.current) return;
    if ((start && !isISODate(start)) || (end && !isISODate(end))) {
      setError("Choose valid dates in YYYY-MM-DD format, or leave both blank for this week.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setContext(null);
    try {
      const fresh = await q.refetch();
      if (fresh.error) throw fresh.error;
      setChoices(fresh.data ?? null);
      setContext(await api.recipeContext(generation, start || undefined, end || undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      title="Recipes, when you choose."
      subtitle="One Håfa account, with separate permissions for the useful connections."
    >
      <Notice>
        These choices allow bounded recipe/meal summaries to be viewed in Workouts. They do not share your training
        profile or Health data back into Recipes. This coach currently does not use Recipes context automatically.
      </Notice>
      {!enrollment?.enrolled && <Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
      <QueryState
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {choices && (
          <Card>
            <Choice
              label="View recipe library summaries here"
              detail="Up to 10 recent accessible saved/owned recipes, with ingredients and reviewed nutrition status."
              selected={choices.library_context}
              disabled={busy}
              onPress={() => setChoices({ ...choices, library_context: !choices.library_context })}
            />
            <Choice
              label="View meal-plan summaries here"
              detail="A selected date range, up to 14 accessible meal entries. Recipe notes stay in Recipes."
              selected={choices.meal_plan_context}
              disabled={busy}
              onPress={() => setChoices({ ...choices, meal_plan_context: !choices.meal_plan_context })}
            />
            <Button
              title="Save Recipes connection choices"
              busy={busy}
              onPress={() => {
                void save();
              }}
            />
          </Card>
        )}
      </QueryState>
      {!!message && <Notice>{message}</Notice>}
      {!!error && (
        <>
          <Notice error>{error}</Notice>
          <Button
            title="Reload saved choices before another change"
            secondary
            disabled={busy}
            onPress={() => {
              void q.refetch().then((result) => {
                if (result.data) {
                  setChoices(result.data);
                  setContext(null);
                  setError("");
                }
              });
            }}
          />
        </>
      )}
      {(q.data?.library_context || q.data?.meal_plan_context) && (
        <Card>
          <Copy kind="heading">Inspect what is available</Copy>
          <Field label="Meal-plan start date · YYYY-MM-DD" value={start} onChange={setStart} optional />
          <Field label="Meal-plan end date · YYYY-MM-DD" value={end} onChange={setEnd} optional />
          <Button
            title="Read permitted summaries"
            secondary
            busy={busy}
            onPress={() => {
              void read();
            }}
          />
        </Card>
      )}
      {context && (
        <>
          <Notice>{context.notice}</Notice>
          <Copy kind="small">
            Meal-plan range · {context.start_date} – {context.end_date}
          </Copy>
          <Copy kind="heading">Recipe library</Copy>
          {!context.library.length && <Copy>No recipe summaries are available in this bounded selection.</Copy>}
          {context.library.map((recipe) => (
            <RecipeSummary key={recipe.id} recipe={recipe} />
          ))}
          <Copy kind="heading">Meal plan</Copy>
          {!context.meal_plan.length && <Copy>No permitted meal entries are available in this date range.</Copy>}
          {context.meal_plan.map((meal) => (
            <Card key={meal.id}>
              <Copy>
                {meal.date} · {meal.meal_type} · {meal.planned_servings ?? "Servings not specified"}
              </Copy>
              <RecipeSummary recipe={meal.recipe} />
            </Card>
          ))}
        </>
      )}
      <Button title="Open Håfa app connections" secondary onPress={() => router.push("/hafa-apps")} />
    </Screen>
  );
}
