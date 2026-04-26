BELFAST_AGENDA = """
Belfast Agenda 2035 — Key Targets:
1. Growing the Economy: 46,000 more people in work by 2035; Belfast GVA growth to £20bn.
2. Living Here: Reduce fuel poverty to under 15%; 4,600 new social homes by 2036.
3. City Development: 66,000 additional residents in Belfast by 2035.
4. Working and Learning: Reduce educational inequality gap by 15%.
5. Sustainability & Resilience: Net Zero by 2050 pathway; 50% reduction in CO2 by 2035.
6. Transport & Connectivity:
   - 50% of journeys by active travel or public transport by 2035.
   - Reduce car dependency to below 60% mode share.
   - DfI targets 50% EV adoption by 2036.
   - Completion of Belfast Rapid Transit (Glider) Phase 2.
   - York Street Interchange operational by 2028.
7. Health & Wellbeing: 15-minute neighbourhood access to primary care, green space, and education.
"""

BOLDER_VISION = """
A Bolder Vision for Belfast — Transport Strategy Summary:
- Prioritise people over cars in the city centre.
- Create a "Civic Spine" from the Transport Hub to Cathedral Quarter.
- Reduce city centre traffic by 20% by 2030.
- Introduce Low Traffic Neighbourhoods in South and East Belfast.
- Expand Glider BRT network to East-West corridor.
- Complete Belfast Bicycle Network by 2030.
- Create car-free zones around schools.
- Support "20 is Plenty" speed limits on residential streets.
"""

UK_CLIMATE_PROJECTIONS = """
UK Climate Projections (UKCP18) — 2030s Summary for Northern Ireland:
- Average temperatures increase by 1.0–1.5°C above 1981–2010 baseline.
- Winter rainfall increases 5–15%; summer rainfall decreases 10–20%.
- Sea level rise: 15–30cm by 2050 (Belfast Lough coastal flood risk).
- Extreme heat events: 2–3x more frequent than 2020 baseline.
- Policy implication: Urban cooling corridors, permeable surfaces, flood-resilient infrastructure.
- Transport impact: EV uptake driven by 2035 ICE ban; cycling infrastructure must be weather-resilient.
"""

GROUNDING_CONTEXT = f"""
You are an urban planning AI for Belfast, Northern Ireland (2036 forecast).
Use the following policy documents to ground all analysis and recommendations.

{BELFAST_AGENDA}

{BOLDER_VISION}

{UK_CLIMATE_PROJECTIONS}

When analyzing simulation results or grounding agent parameters, always reference specific targets
from these documents. Provide actionable, specific recommendations tied to geographic areas of Belfast.
"""

GROUNDING_SYSTEM_PROMPT = """
You are the Belfast Urban Intelligence Engine, part of BIMS 5 — a Building and Infrastructure
Management Simulator. Your role is to:

1. GROUND simulation parameters based on real Belfast policy targets.
2. ANALYZE simulation results against policy benchmarks.
3. SCORE outcomes on Sustainability, Congestion, and Equity.
4. ADVISE on specific infrastructure interventions.

Always be specific: name streets, neighbourhoods, and exact policy targets.
Format your output as structured JSON when requested.
"""
