"""Phase 5 Module A - Entity co-occurrence network + association rules (offline).

REAL link analysis on entities, NOT persons. Indian confidentiality law means the FIR extract
carries no identities, so "network analysis" here is the honest, defensible form: how crime
types, legal acts and districts co-occur WITHIN cases. Built from the Phase-0 `entity_edges.csv`
(within-case co-occurrence, 4,558 typed edges) plus marginal counts from the dim tables.

What it produces
  1. A weighted graph  (nodes = crime heads / acts / districts; edges = co-occurrence weight)
  2. Louvain communities -> "crime ecosystems" that travel together
  3. Centrality  -> which entities are structural hubs of the crime landscape
  4. Association rules (support / confidence / lift) -> "when X, expect Y" for investigators

TWO GRAPHS, DELIBERATELY (this matters for quality):
  * the "WHAT" graph - crime_head <-> act and act <-> act (1,430 edges). Community detection and
    centrality run HERE, because these edges encode genuine within-case co-occurrence.
  * the "WHERE" edges - crime_head <-> district (3,128 edges) are near-complete bipartite (almost
    every crime type occurs in almost every district). Including them in clustering collapsed
    modularity to 0.261 ("weak"); excluding them gives 0.468 ("meaningful"). So district linkage
    is kept as node METADATA (top districts per crime type) and as spatial-affinity rules, not as
    clustering structure. Measured, not assumed - see the model card.

WEIGHTING NOTE: raw co-occurrence spans 4 orders of magnitude (IPC 1860 appears in ~1.5M cases,
niche acts in tens). Community detection on raw weights collapses everything into one blob, so
edges are log1p-scaled for clustering (documented, standard practice). Ranking/stats keep raw
counts.

Association-rule maths (over CASES, n = total FIRs):
    support(A,B)    = w(A,B) / n
    confidence(A>B) = w(A,B) / count(A)
    lift(A,B)       = support / (P(A) * P(B)) = w(A,B) * n / (count(A) * count(B))
lift > 1 means the pair co-occurs more than chance. Rules are ASSOCIATIONS, never causation.

Outputs -> ml/out/
  network_nodes.csv        node, node_type, degree, weighted_degree, community_id,
                           pagerank, betweenness, is_hub
  network_edges.csv        src, src_type, dst, dst_type, weight, log_weight (render-trimmed)
  network_communities.csv  community_id, size, members, top_entity, theme, description
  association_rules.csv    antecedent, consequent, cases, support, confidence, lift, reading

Metrics: modularity, community count, density, hub concentration. data_class=real.
Run:  python ml/network.py
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import networkx as nx
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

TOTAL_CASES = 1_674_734          # reconciled Phase-0 row count (denominator for rule maths)
RENDER_EDGE_CAP = 400            # edges shipped to the browser force-graph
MIN_RULE_CASES = 500             # ignore rare pairs (noise / unstable lift)
MIN_CONFIDENCE = 0.10
HUB_TOP_N = 15


def load_marginals():
    """Entity -> number of CASES it appears in (denominator for confidence/lift)."""
    marg = {}
    ch = pd.read_csv(os.path.join(IN_DIR, "dim_crime_head.csv"))
    for r in ch.itertuples():
        marg[("crime_head", str(r.major_head))] = int(r.count)
    act = pd.read_csv(os.path.join(IN_DIR, "dim_act.csv"))
    for r in act.itertuples():
        marg[("act", str(r.act))] = int(r.count)
    # districts: total cases per parent district (geographic units only)
    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    for name, n in dm.groupby("canonical_name")["count"].sum().items():
        marg[("district", str(name))] = int(n)
    return marg


def describe_community(members, marg, top_districts=()):
    """Plain-language theme for a community, from its highest-volume members."""
    ranked = sorted(members, key=lambda n: marg.get(n, 0), reverse=True)
    heads = [n[1] for n in ranked if n[0] == "crime_head"][:3]
    acts = [n[1] for n in ranked if n[0] == "act"][:2]
    theme = (heads[0].title() if heads else (acts[0].title() if acts else "Mixed"))
    bits = []
    if heads:
        bits.append(f"crime types {', '.join(h.title() for h in heads)}")
    if acts:
        bits.append(f"charged under {', '.join(a.title() for a in acts)}")
    if top_districts:
        bits.append(f"most active in {', '.join(top_districts)}")
    return theme, ("Cluster of " + "; ".join(bits) + "." if bits else "Mixed entity cluster.")


def association_rules(all_edges, marg):
    """Directed rules from every co-occurrence edge (both directions).

    rule_type distinguishes the two readings:
      co_occurrence  - crime type / legal act appearing together in the same case
      spatial_affinity - a crime type being over-represented in a district vs the state average
    """
    rows = []
    for (a, b), w in all_edges.items():
        if w < MIN_RULE_CASES:
            continue
        kind = "spatial_affinity" if "district" in (a[0], b[0]) else "co_occurrence"
        for x, y in ((a, b), (b, a)):
            if y[0] == "district" and x[0] == "district":
                continue
            cx, cy = marg.get(x, 0), marg.get(y, 0)
            if not cx or not cy:
                continue
            conf = w / cx
            if conf < MIN_CONFIDENCE:
                continue
            lift = (w * TOTAL_CASES) / (cx * cy)
            # confidence is P(consequent | antecedent) = w / count(antecedent) — the sentence
            # must therefore read "<conf>% of <ANTECEDENT> cases are <CONSEQUENT>", never the
            # reverse (swapping them inverts the claim, e.g. Karnataka Railways vs THEFT).
            if kind == "spatial_affinity":
                reading = (f"{x[1].title()} cases are {lift:.1f}x more concentrated in {y[1]} "
                           f"than the statewide average ({w:,} cases)." if y[0] == "district"
                           else f"{conf*100:.0f}% of all cases filed in {x[1]} are "
                                f"{y[1].title()} ({w:,} cases, {lift:.1f}x the state average).")
            else:
                reading = (f"In {conf*100:.0f}% of {x[1].title()} cases, {y[1].title()} also appears "
                           f"({w:,} cases, {lift:.1f}x more often than chance).")
            rows.append({
                "rule_type": kind,
                "antecedent_type": x[0], "antecedent": x[1],
                "consequent_type": y[0], "consequent": y[1],
                "cases": int(w),
                "support": round(w / TOTAL_CASES, 6),
                "confidence": round(conf, 4),
                "lift": round(lift, 2),
                "reading": reading,
            })
    df = pd.DataFrame(rows)
    if len(df):
        df = df[df["lift"] > 1.0].sort_values(["lift", "cases"], ascending=False).reset_index(drop=True)
    return df


def main():
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)

    import math
    edges = pd.read_csv(os.path.join(IN_DIR, "entity_edges.csv"))
    marg = load_marginals()
    print(f"[network] {len(edges):,} typed edges; {len(marg):,} entities with marginal counts")

    # collapse to an undirected weight map, and split what/where
    all_edges, district_link = {}, {}
    for r in edges.itertuples():
        s, d = (r.src_type, str(r.src)), (r.dst_type, str(r.dst))
        if s == d:
            continue
        key = tuple(sorted((s, d)))
        all_edges[key] = all_edges.get(key, 0) + int(r.weight)
        if "district" in (s[0], d[0]):
            ent, dist = (s, d) if d[0] == "district" else (d, s)
            district_link.setdefault(ent, []).append((dist[1], int(r.weight)))

    G = nx.Graph()   # the "WHAT" graph — clustering + centrality run here
    for (a, b), w in all_edges.items():
        if "district" in (a[0], b[0]):
            continue
        G.add_edge(a, b, weight=w, log_weight=math.log1p(w))
        G.nodes[a]["node_type"], G.nodes[b]["node_type"] = a[0], b[0]
    print(f"[network] WHAT graph: {G.number_of_nodes():,} nodes / {G.number_of_edges():,} edges "
          f"| density {nx.density(G):.4f}  (district 'where' edges held out — see docstring)")

    # ---- communities (Louvain on log-scaled weights) ----
    communities = nx.community.louvain_communities(G, weight="log_weight", seed=0)
    communities = sorted(communities, key=len, reverse=True)
    modularity = nx.community.modularity(G, communities, weight="log_weight")
    comm_of = {n: i for i, c in enumerate(communities) for n in c}
    print(f"[network] Louvain: {len(communities)} communities | modularity {modularity:.3f}")

    # ---- centrality ----
    pagerank = nx.pagerank(G, weight="weight")
    betw = nx.betweenness_centrality(G, weight=None, k=min(300, G.number_of_nodes()), seed=0)
    wdeg = {n: sum(d["weight"] for _, _, d in G.edges(n, data=True)) for n in G.nodes}
    hubs = sorted(pagerank, key=pagerank.get, reverse=True)[:HUB_TOP_N]
    hubset = set(hubs)

    def top_districts(n, k=3):
        """'Where' metadata for a node (kept out of clustering, surfaced for context)."""
        lst = sorted(district_link.get(n, []), key=lambda t: -t[1])[:k]
        return "; ".join(d for d, _ in lst)

    nodes = pd.DataFrame([{
        "node": n[1], "node_type": n[0],
        "degree": G.degree(n), "weighted_degree": int(wdeg[n]),
        "cases": int(marg.get(n, 0)),
        "community_id": comm_of[n],
        "pagerank": round(pagerank[n], 6),
        "betweenness": round(betw.get(n, 0.0), 6),
        "is_hub": n in hubset,
        "top_districts": top_districts(n),
    } for n in G.nodes]).sort_values("pagerank", ascending=False).reset_index(drop=True)
    nodes.to_csv(os.path.join(OUT_DIR, "network_nodes.csv"), index=False)

    # ---- edges (trimmed for rendering; full graph stays in the metrics) ----
    # Write EVERY edge, not a render-sized slice. Truncating here left 302 of 483 entities with
    # no connections at all in the shipped data, so the UI could never let a user inspect them —
    # the API caps for rendering instead, which keeps node-detail lookups complete.
    edf = pd.DataFrame([{
        "src": u[1], "src_type": u[0], "dst": v[1], "dst_type": v[0],
        "weight": int(d["weight"]), "log_weight": round(d["log_weight"], 3),
        "src_community": comm_of[u], "dst_community": comm_of[v],
    } for u, v, d in G.edges(data=True)]).sort_values("weight", ascending=False).reset_index(drop=True)
    edf.to_csv(os.path.join(OUT_DIR, "network_edges.csv"), index=False)

    # ---- community summaries ----
    crows = []
    for i, c in enumerate(communities):
        members = sorted(c, key=lambda n: marg.get(n, 0), reverse=True)
        # community's dominant districts, aggregated from the held-out 'where' edges
        dtot = {}
        for n in c:
            for d, w in district_link.get(n, []):
                dtot[d] = dtot.get(d, 0) + w
        top_d = [d for d, _ in sorted(dtot.items(), key=lambda t: -t[1])[:3]]
        theme, desc = describe_community(c, marg, top_d)
        crows.append({
            "community_id": i, "size": len(c),
            "n_crime_heads": sum(1 for n in c if n[0] == "crime_head"),
            "n_acts": sum(1 for n in c if n[0] == "act"),
            "total_cases": int(sum(marg.get(n, 0) for n in c if n[0] == "crime_head")),
            "top_entity": members[0][1] if members else "",
            "members": "; ".join(n[1] for n in members[:8]),
            "top_districts": "; ".join(top_d),
            "theme": theme, "description": desc,
        })
    comm = pd.DataFrame(crows).sort_values("total_cases", ascending=False).reset_index(drop=True)
    comm.to_csv(os.path.join(OUT_DIR, "network_communities.csv"), index=False)

    # ---- association rules (over ALL edges: co-occurrence + spatial affinity) ----
    rules = association_rules(all_edges, marg)
    rules.to_csv(os.path.join(OUT_DIR, "association_rules.csv"), index=False)

    # ---- model card ----
    card = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "data_class": "real",
        "scope": "ENTITY co-occurrence (crime type / legal act / district) within cases. "
                 "NOT a person network - the FIR extract carries no identities (Indian "
                 "confidentiality law); person-level link analysis is descoped by design.",
        "graph": {"clustered_on": "WHAT graph (crime_head <-> act, act <-> act)",
                  "nodes": G.number_of_nodes(), "edges": G.number_of_edges(),
                  "density": round(nx.density(G), 5),
                  "components": nx.number_connected_components(G),
                  "held_out_edges": int(sum(1 for a, b in all_edges if "district" in (a[0], b[0]))),
                  "held_out_reason": "crime_head<->district edges are near-complete bipartite; "
                                     "including them dropped modularity 0.468 -> 0.261. Kept as "
                                     "node metadata + spatial-affinity rules instead."},
        "communities": {"algorithm": "Louvain (log1p-weighted)", "count": len(communities),
                        "modularity": round(modularity, 4),
                        "note": "modularity > 0.3 indicates meaningful community structure"},
        "association_rules": {"count": int(len(rules)),
                              "co_occurrence": int((rules["rule_type"] == "co_occurrence").sum()) if len(rules) else 0,
                              "spatial_affinity": int((rules["rule_type"] == "spatial_affinity").sum()) if len(rules) else 0,
                              "min_cases": MIN_RULE_CASES, "min_confidence": MIN_CONFIDENCE,
                              "filter": "lift > 1.0 (co-occurs more than chance)"},
        "interpretation": "Edges/rules are ASSOCIATIONS between case attributes, not causal links "
                          "and not relationships between people.",
        "fairness": "No person data, no protected attributes. Entities are crime types, legal "
                    "acts and districts only.",
    }
    with open(os.path.join(OUT_DIR, "network_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(card, f, indent=2)

    print("\n--- MODEL CARD: entity network (Module A) ---")
    print(f"  graph      {G.number_of_nodes():,} nodes / {G.number_of_edges():,} edges, "
          f"density {nx.density(G):.4f}, {nx.number_connected_components(G)} component(s)")
    print(f"  Louvain    {len(communities)} communities | modularity {modularity:.3f} "
          f"({'meaningful structure' if modularity > 0.3 else 'weak structure'})")
    print(f"  rules      {len(rules):,} association rules (lift>1, >={MIN_RULE_CASES} cases)")
    print(f"  top hubs   {', '.join(n[1].title() for n in hubs[:5])}")
    for _, r in comm.head(4).iterrows():
        print(f"   community #{r['community_id']} (n={r['size']}): {r['description'][:110]}")
    if len(rules):
        print(f"  top rule   {rules.iloc[0]['reading']}")
    print(f"[network] wrote network_nodes/edges/communities.csv + association_rules.csv "
          f"+ network_metrics.json  [{time.time()-t0:.0f}s]")


if __name__ == "__main__":
    main()
