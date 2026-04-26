import random

from .models import Adult, Building

SUPERMARKET_TAGS = frozenset({"supermarket", "convenience"})
HEALTHCARE_TAGS = frozenset({"hospital", "clinic", "pharmacy", "doctors", "dentist"})
EDUCATION_TAGS = frozenset({"school", "kindergarten"})
RETAIL_TAGS = frozenset({"clothes", "shoes", "florist"})
FOOD_TAGS = frozenset({"fast_food", "restaurant", "cafe"})

BASE_WORK_WEIGHTS = {
    "supermarket": 0.15,
    "healthcare": 0.15,
    "education": 0.15,
    "retail": 0.40,
    "food": 0.15,
}


def categorize_work_buildings(buildings: list[Building]) -> dict[str, list[Building]]:
    categories: dict[str, list[Building]] = {k: [] for k in BASE_WORK_WEIGHTS}
    for b in buildings:
        shop = b.get_tag("shop")
        amenity = b.get_tag("amenity")
        if shop in SUPERMARKET_TAGS:
            categories["supermarket"].append(b)
        if shop in RETAIL_TAGS:
            categories["retail"].append(b)
        if amenity in HEALTHCARE_TAGS:
            categories["healthcare"].append(b)
        if amenity in EDUCATION_TAGS:
            categories["education"].append(b)
        if amenity in FOOD_TAGS:
            categories["food"].append(b)
    return categories


def calculate_work_distribution_weights(
    work_categories: dict[str, list[Building]],
) -> tuple[list[tuple[str, list[Building]]], list[float]]:
    available_categories = []
    weights = []

    for category, cat_buildings in work_categories.items():
        if cat_buildings:
            available_categories.append((category, cat_buildings))
            weights.append(BASE_WORK_WEIGHTS[category])

    total_weight = sum(weights)
    if total_weight > 0:
        weights = [w / total_weight for w in weights]

    return available_categories, weights


def assign_work_location(
    adult: Adult,
    available_categories: list[tuple[str, list[Building]]],
    weights: list[float],
) -> Adult:
    if not available_categories:
        return adult

    category, category_buildings = random.choices(
        available_categories, weights=weights
    )[0]
    work_building = random.choice(category_buildings)

    return adult.model_copy(update={"work": work_building, "work_type": category})
