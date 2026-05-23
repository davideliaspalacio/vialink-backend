#!/usr/bin/env bash
# Vialink — fire a batch of API calls to trigger every event type in the WS client.
# Run this in a third terminal while `node test/ws-client.js` is running.
#
# Usage:
#   ./test/trigger-events.sh
#   API_URL=http://localhost:3000/api/v1 ./test/trigger-events.sh

set -e

API_URL=${API_URL:-http://localhost:3000/api/v1}
EMAIL=${EMAIL:-carlos@vialink.test}
PASSWORD=${PASSWORD:-vialinkpass123}

c_blue='\033[0;34m'; c_green='\033[0;32m'; c_yellow='\033[0;33m'; c_reset='\033[0m'

echo -e "${c_blue}🔑 Logging in as $EMAIL${c_reset}"
TOKEN=$(curl -s -X POST "$API_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed. Run signup first if user doesn't exist."
  exit 1
fi
echo -e "${c_green}✅ Token captured${c_reset}"

ROUTE_C12=$(curl -s "$API_URL/routes" | python3 -c "import sys,json;d=json.load(sys.stdin);print([r['id'] for r in d['routes'] if r['code']=='C12'][0])")
echo -e "Route C12: $ROUTE_C12"

# 1. Cancel any active trip from a previous run (so POST /trips won't 409)
echo -e "\n${c_yellow}🧹 Clean any active trip${c_reset}"
ACTIVE=$(curl -s "$API_URL/trips/active" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;t=json.load(sys.stdin).get('trip');print(t['id'] if t else '')")
if [ -n "$ACTIVE" ]; then
  curl -s -X PATCH "$API_URL/trips/$ACTIVE" \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"status":"CANCELLED"}' > /dev/null
  echo "  Cancelled previous trip $ACTIVE"
fi

sleep 1

# 2. Create a wait session → will receive wait_session_alert within ~5s
echo -e "\n${c_yellow}📍 Creating wait session at Uninorte (route C12, notify 600s before)${c_reset}"
curl -s -X POST "$API_URL/wait-sessions" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"location\":{\"lat\":11.0186,\"lng\":-74.8499},\"route_id\":\"$ROUTE_C12\",\"notify_seconds_before\":600}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'  → wait_session_id={d[\"id\"]}')"

sleep 2

# 3. Start a trip → trip_update event
echo -e "\n${c_yellow}🚗 Starting trip (Uninorte → Centro)${c_reset}"
TRIP_ID=$(curl -s -X POST "$API_URL/trips" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"route_id\":\"$ROUTE_C12\",\"boarding_location\":{\"lat\":11.0186,\"lng\":-74.8499},\"dropoff_location\":{\"lat\":10.9656,\"lng\":-74.7826}}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo "  → trip_id=$TRIP_ID"

sleep 2

# 4. Report an incident → incident_reported event
echo -e "\n${c_yellow}⚠️  Reporting incident (TRAFFIC on C12)${c_reset}"
curl -s -X POST "$API_URL/incidents" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"type\":\"TRAFFIC\",\"route_id\":\"$ROUTE_C12\",\"location\":{\"lat\":10.99,\"lng\":-74.81},\"description\":\"Trancón fuerte\"}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'  → incident_id={d[\"id\"]}')"

sleep 2

# 5. Complete the trip → trip_update event
echo -e "\n${c_yellow}🏁 Completing trip${c_reset}"
curl -s -X PATCH "$API_URL/trips/$TRIP_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"status":"COMPLETED"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'  → status={d[\"status\"]}')"

sleep 1

# 6. Ask the AI assistant
echo -e "\n${c_yellow}🤖 Asking Claude assistant${c_reset}"
curl -s -X POST "$API_URL/assistant/ask" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"question":"¿Cuándo viene el próximo bus a Uninorte?","location":{"lat":11.0186,"lng":-74.8499}}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'  → answer: {d[\"answer\"][:90]}')"

echo -e "\n${c_green}✅ All events triggered. Check the WS client window for live events.${c_reset}"
