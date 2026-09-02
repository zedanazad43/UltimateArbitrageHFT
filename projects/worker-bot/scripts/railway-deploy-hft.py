"""
Railway HFT Engine Deployer
===========================
Triggers a deployment of the Go HFT engine on Railway via the GraphQL API.
The service is already linked to zedanazad43/UltimateArbitrageHFT on GitHub.
This script triggers a redeploy of the latest commit on main.

Usage:
    python scripts/railway-deploy-hft.py
"""
import requests, os, sys

# Configuration
API_URL = "https://backboard.railway.app/graphql/v2"
PROJECT_ID = os.getenv("RAILWAY_PROJECT_ID", "3eb74947-b28a-4b9e-8904-9c33839e0777")
SERVICE_ID = os.getenv("RAILWAY_SERVICE_ID", "ad1edd5e-c60a-421b-b6e3-a8ab4278a354")
ENVIRONMENT_ID = os.getenv("RAILWAY_ENVIRONMENT_ID", "d141cfa6-6744-4edb-acea-577036284a46")

TOKEN = os.getenv("RAILWAY_API_TOKEN", "")
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}

def gql(query, variables=None):
    """Execute a GraphQL query against the Railway API."""
    body = {"query": query}
    if variables:
        body["variables"] = variables
    r = requests.post(API_URL, headers=HEADERS, json=body, timeout=30)
    if r.status_code != 200:
        print(f"HTTP {r.status_code}: {r.text[:500]}")
        return None
    data = r.json()
    if "errors" in data:
        for err in data["errors"]:
            print(f"GraphQL Error: {err['message']}")
        return None
    return data.get("data")

def get_service_status():
    """Get current service deployment status."""
    query = """
    query($serviceId: String!) {
      service(id: $serviceId) {
        id name
        serviceInstances {
          edges {
            node {
              id
              domains { serviceDomains { domain } }
              latestDeployment {
                id status
                createdAt
                staticUrl
              }
            }
          }
        }
      }
    }
    """
    return gql(query, {"serviceId": SERVICE_ID})

def trigger_deploy():
    """Trigger a new deployment from the GitHub-connected repo."""
    # Railway v2 mutation to deploy from GitHub-connected service
    # Uses deployFromGitHubRepo which triggers a fresh build from the main branch
    mutation = """
    mutation($input: DeploymentTriggerInput!) {
      deploymentTrigger(input: $input) {
        id
        status
        createdAt
      }
    }
    """
    variables = {
        "input": {
            "serviceId": SERVICE_ID,
            "environmentId": ENVIRONMENT_ID,
        }
    }
    return gql(mutation, variables)

def main():
    if not TOKEN:
        print("ERROR: Set RAILWAY_API_TOKEN environment variable.")
        print("Get a token from: https://railway.app/account/tokens")
        print("Then run: $env:RAILWAY_API_TOKEN='your-token'; python scripts/railway-deploy-hft.py")
        sys.exit(1)

    print("=" * 60)
    print("Railway HFT Engine Deployment")
    print("=" * 60)

    # Step 1: Check current status
    print("\n[1/3] Checking service status...")
    status = get_service_status()
    if not status:
        print("  FAILED: Could not query service. Token may be invalid.")
        sys.exit(1)

    svc = status.get("service", {})
    instances = svc.get("serviceInstances", {}).get("edges", [])
    domain = ""
    if instances:
        inst = instances[0].get("node", {})
        domains = inst.get("domains", {}).get("serviceDomains", [])
        if domains:
            domain = domains[0].get("domain", "")

    print(f"  Service: {svc.get('name', '?')}")
    print(f"  Domain:  {domain or '(none - will be assigned on deploy)'}")

    # Step 2: Trigger deployment
    print("\n[2/3] Triggering deployment from GitHub (main branch)...")
    result = trigger_deploy()
    if not result:
        # Try alternate mutation (Railway API changes frequently)
        print("  Primary mutation failed. Trying alternate approach...")

        # Fallback: redeploy the latest deployment
        alt_mutation = """
        mutation($serviceId: String!, $environmentId: String!) {
          deploymentRedeploy(
            serviceId: $serviceId
            environmentId: $environmentId
          ) {
            id
            status
          }
        }
        """
        result = gql(alt_mutation, {
            "serviceId": SERVICE_ID,
            "environmentId": ENVIRONMENT_ID,
        })

    if result:
        print("  Deployment triggered successfully!")
        print(f"  Response: {result}")
    else:
        print("  Could not trigger via API. Trying CLI fallback...")
        os.system("railway up -s UltimateArbitrageHFT -d")
        sys.exit(1)

    # Step 3: Summary
    print("\n[3/3] Deployment initiated!")
    print(f"\n  Monitor progress at: https://railway.app/project/{PROJECT_ID}/service/{SERVICE_ID}")
    print(f"  Or via CLI: railway logs -s UltimateArbitrageHFT")
    print("\n  After deployment, set in wrangler.toml:")
    if domain:
        print(f"  HFT_ENGINE_URL = \"https://{domain}\"")
    else:
        print("  HFT_ENGINE_URL = \"https://<your-service>.up.railway.app\"")

if __name__ == "__main__":
    main()
