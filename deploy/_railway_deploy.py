import requests, json, sys

TOKEN = 'fa26ef21-1468-46e3-92a9-c638ad730383'
PROJECT_ID = '4206ca37-7e37-47a4-b0cd-05506db2c4b3'
HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}
API = 'https://backboard.railway.app/graphql/v2'

def gql(query, variables=None):
    body = {'query': query}
    if variables: body['variables'] = variables
    r = requests.post(API, headers=HEADERS, json=body)
    if r.status_code != 200:
        print(f'HTTP {r.status_code}: {r.text[:300]}')
        return None
    return r.json()

# Step 1: List existing services
result = gql('{ services(projectId: \"' + PROJECT_ID + '\") { edges { node { id name serviceInstances { edges { node { id domains { serviceDomains { domain } } source { repo dockerfilePath rootDirectory } } } } } } } }')
if result:
    for e in result.get('data',{}).get('services',{}).get('edges',[]):
        svc = e['node']
        instances = svc.get('serviceInstances',{}).get('edges',[])
        domain = ''
        if instances:
            doms = instances[0]['node'].get('domains',{}).get('serviceDomains',[]) or []
            if doms: domain = doms[0]['domain']
        print(f'Service: {svc[\"name\"]} id={svc[\"id\"]} domain={domain}')
else:
    print('Failed to list services')
