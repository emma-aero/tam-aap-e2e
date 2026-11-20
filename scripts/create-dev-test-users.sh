#!/usr/bin/env bash
# Creates (or resets) the two e2e test users in the DEV Keycloak, realm aap-tam, and writes
# their credentials into .env. Run it yourself; it prints no secrets.
#
#   E2E user : a.amir+e2e-user@emma.aero   (default realm roles, like a self-registered user)
#   E2E admin: a.amir+e2e-admin@emma.aero  (default roles + requests:admin)
#
# Needs: kubectl access to the dev cluster, curl, jq, openssl.
# Safe to re-run: existing users are updated and get a new password.
set -euo pipefail

CONTEXT="eks-admin@emma-dev-cluster.eu-north-1.eksctl.io"   # dev only, never prod
KC_NS="common-svc"; KC_SVC="my-keycloak"; KC_PORT=9090
REALM="aap-tam"
KC="http://localhost:${KC_PORT}/auth"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

USER_EMAIL="a.amir+e2e-user@emma.aero"
ADMIN_EMAIL="a.amir+e2e-admin@emma.aero"

for bin in kubectl curl jq openssl; do command -v $bin >/dev/null || { echo "missing: $bin"; exit 1; }; done

# --- tunnel to the dev Keycloak (reuse one if already open) ---
PF_PID=""
if ! curl -sf -o /dev/null "$KC/realms/$REALM"; then
  kubectl --context "$CONTEXT" -n "$KC_NS" port-forward "svc/$KC_SVC" "$KC_PORT:$KC_PORT" >/dev/null 2>&1 &
  PF_PID=$!
  for _ in $(seq 1 20); do curl -sf -o /dev/null "$KC/realms/$REALM" && break; sleep 1; done
fi
trap '[ -n "$PF_PID" ] && kill $PF_PID 2>/dev/null || true' EXIT

# --- admin token (credentials read from the cluster secret, never printed) ---
ADMIN_USER=$(kubectl --context "$CONTEXT" -n "$KC_NS" get secret keycloak-admin-secret -o jsonpath='{.data.username}' | base64 -d)
ADMIN_PASS=$(kubectl --context "$CONTEXT" -n "$KC_NS" get secret keycloak-admin-secret -o jsonpath='{.data.password}' | base64 -d)
TOKEN=$(curl -sf -X POST "$KC/realms/master/protocol/openid-connect/token" \
  --data-urlencode "client_id=admin-cli" --data-urlencode "grant_type=password" \
  --data-urlencode "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" | jq -r .access_token)
unset ADMIN_PASS
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "could not get an admin token"; exit 1; }
api() { curl -sf -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }
A="$KC/admin/realms/$REALM"

gen_password() { echo "E2e-$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)-9a!"; }

# create or update a user; prints its id
upsert_user() {
  local email=$1 first=$2 last=$3
  local body; body=$(jq -n --arg e "$email" --arg f "$first" --arg l "$last" '{
    username:$e, email:$e, firstName:$f, lastName:$l, enabled:true, emailVerified:true,
    attributes:{ jobTitle:["QA Automation"], employerType:["Others"], employerTypeOther:["EMMA e2e"],
      employerName:["Others"], employerNameOther:["EMMA e2e"], country:["Qatar"],
      domain:["Airfield"], phoneNumber:["+97400000000"] } }')
  local id; id=$(api "$A/users?email=$(jq -rn --arg e "$email" '$e|@uri')&exact=true" | jq -r '.[0].id // empty')
  if [ -z "$id" ]; then
    api -X POST "$A/users" -d "$body" >/dev/null
    id=$(api "$A/users?email=$(jq -rn --arg e "$email" '$e|@uri')&exact=true" | jq -r '.[0].id')
    echo "created $email" >&2
  else
    api -X PUT "$A/users/$id" -d "$body" >/dev/null
    echo "updated $email" >&2
  fi
  echo "$id"
}

set_password() {
  local id=$1 pw=$2
  api -X PUT "$A/users/$id/reset-password" -d "$(jq -n --arg p "$pw" '{type:"password",value:$p,temporary:false}')" >/dev/null
}

# grant a role by name: realm role first, else a client role with that name
grant_role() {
  local id=$1 name=$2
  local enc; enc=$(jq -rn --arg r "$name" '$r|@uri')
  local role; role=$(api "$A/roles/$enc" 2>/dev/null || true)
  if [ -n "$role" ]; then
    api -X POST "$A/users/$id/role-mappings/realm" -d "[$role]" >/dev/null
    echo "  granted realm role $name" >&2; return
  fi
  for cid in $(api "$A/clients?max=500" | jq -r '.[].id'); do
    role=$(api "$A/clients/$cid/roles/$enc" 2>/dev/null || true)
    if [ -n "$role" ]; then
      api -X POST "$A/users/$id/role-mappings/clients/$cid" -d "[$role]" >/dev/null
      echo "  granted client role $name ($(api "$A/clients/$cid" | jq -r .clientId))" >&2; return
    fi
  done
  echo "  WARNING: role $name not found in realm $REALM" >&2
}
grant_requests_admin() { grant_role "$1" "requests:admin"; }

USER_ID=$(upsert_user "$USER_EMAIL" "E2E" "User")
ADMIN_ID=$(upsert_user "$ADMIN_EMAIL" "E2E" "Admin")
# Both users may comment (needed by the comment tests); the admin also reviews requests.
for id in "$USER_ID" "$ADMIN_ID"; do
  for r in comments:create comments:update_own comments:delete_own; do grant_role "$id" "$r"; done
done
grant_requests_admin "$ADMIN_ID"

USER_PW=$(gen_password); ADMIN_PW=$(gen_password)
set_password "$USER_ID" "$USER_PW"
set_password "$ADMIN_ID" "$ADMIN_PW"

# --- write .env (git-ignored), keeping any other settings ---
[ -f "$ENV_FILE" ] || cp "$(dirname "$ENV_FILE")/.env.example" "$ENV_FILE"
setkv() { local k=$1 v=$2; grep -v "^$k=" "$ENV_FILE" > "$ENV_FILE.tmp" || true; echo "$k=$v" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }
setkv E2E_USER_EMAIL "$USER_EMAIL"; setkv E2E_USER_PASSWORD "$USER_PW"
setkv E2E_ADMIN_EMAIL "$ADMIN_EMAIL"; setkv E2E_ADMIN_PASSWORD "$ADMIN_PW"
chmod 600 "$ENV_FILE"
unset USER_PW ADMIN_PW TOKEN

echo "Done. Credentials written to $ENV_FILE (not printed)."
