import requests
TOKEN = "fa26ef21-1468-46e3-92a9-c638ad730383"
H = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}
U = "https://backboard.railway.app/graphql/v2"

# Try both project IDs
for pid in ["4206ca37-7e37-47a4-b0cd-05506db2c4b3", "069bb8ab-51ec-4bf4-a1fa-8e14ee0deaf7"]:
    q = 'query($pid: String!){ services(projectId: $pid) { edges { node { id name } } } }'
    r = requests.post(U, headers=H, json={"query": q, "variables": {"pid": pid}})
    print(f"Project {pid}: HTTP {r.status_code}")
    if r.status_code == 200:
        d = r.json()
        edges = d.get("data",{}).get("services",{}).get("edges",[]) or []
        for e in edges:
            print(f"  {e['node']['name']}: {e['node']['id']}")
        if not edges: print("  No services")
    else:
        print(f"  {r.text[:200]}")
