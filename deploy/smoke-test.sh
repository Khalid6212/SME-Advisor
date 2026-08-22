#!/usr/bin/env bash
# End-to-end test, run on the server against the live stack.
#
# Exercises the paths that only fail in a real deployment: authentication,
# the interview agent, the data room, the planner, and the plan approval
# gate. Uses invented data.
#
#   bash deploy/smoke-test.sh
#
# Talks to PUBLIC_URL, not localhost — Caddy force-redirects plain HTTP to
# HTTPS (the domain requires it), and `curl -sf` does not follow redirects,
# so a localhost call used to "pass" on an empty 308 response without ever
# reaching the API. Every check below is on the real response.
#
# Signing in reads the magic-link token from the database rather than the
# container log: production emails it for real (via the configured SMTP
# provider) rather than printing it, which is the correct behaviour and
# means the log never has it. The token is inserted the same way
# issueMagicLink() in api/src/auth.ts generates one — a random token and its
# sha256 hash — then consumed through the real /auth/verify endpoint, so
# session creation, expiry, and consumption all still run for real. This is
# not a login bypass: no session or auth_sessions row is ever written
# directly, only the token a real email would have carried.

set -uo pipefail
cd "$(dirname "$0")/.."

DC="sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
PSQL="$DC exec -T postgres psql -U sme -d sme_advisor -tAqc"
BASE="$(grep -m1 '^PUBLIC_URL=' deploy/.env | cut -d= -f2-)/api"
JAR=$(mktemp)
EMAIL="test@falak.sa"
pass=0; fail=0

check() { # check <label> <condition-result>
  if [ "$2" = "0" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1"; fail=$((fail+1)); fi
}

echo "=== 1. health"
curl -sf "$BASE/health" | grep -q in_kingdom
check "API healthy and reporting in_kingdom" $?

echo "=== 2. sign in"
curl -sf -o /dev/null -X POST "$BASE/auth/magic-link" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}"
check "magic link requested (real email sent — not read back here)" $?

# Same token shape and hash as issueMagicLink(): a random base64url token,
# stored as its sha256 hash. Generated with the api container's own Node so
# there is no risk of a bash-side encoding mismatch.
read -r TOKEN HASH <<EOF
$($DC exec -T api node -e "
  const c = require('crypto');
  const t = c.randomBytes(32).toString('base64url');
  console.log(t, c.createHash('sha256').update(t).digest('hex'));
")
EOF
[ -n "${HASH:-}" ]; check "test token generated" $?

USER_ID=$($PSQL "SELECT id FROM users WHERE email='$EMAIL'")
$PSQL "INSERT INTO magic_links (user_id, token_hash, expires_at)
       VALUES ('$USER_ID', '$HASH', now() + interval '30 minutes')" >/dev/null
check "test token registered for $EMAIL" $?

curl -sf -o /dev/null -c "$JAR" "$BASE/auth/verify?token=$TOKEN"
check "session established via the real verify endpoint" $?

curl -sf -b "$JAR" "$BASE/auth/me" | grep -q "$EMAIL"
check "signed in as $EMAIL" $?

# Managers are provisioned deliberately; new accounts are clients.
$PSQL "UPDATE users SET role='manager' WHERE email='$EMAIL'" >/dev/null
check "promoted to manager" $?

echo "=== 3. interview agent"
BODY='{"name":"Wadi Plastics","brief":"We make plastic packaging for food producers in Riyadh. One factory, four extrusion lines, about 40 staff."}'
OUT=$(curl -sf -b "$JAR" -X POST "$BASE/me/clients" -H 'content-type: application/json' -d "$BODY")
check "business created and first turn ran" $?

CID=$(echo "$OUT" | grep -o '"client_id":"[^"]*' | cut -d'"' -f4)
echo "$OUT" | grep -q '"reply":"..*"'
check "agent replied with questions" $?
echo "        > $(echo "$OUT" | sed 's/.*"reply":"//;s/\\n.*//' | cut -c1-90)..."

echo "=== 4. data room"
curl -sf -o /dev/null -b "$JAR" -X POST "$BASE/clients/$CID/data-room" \
  -H 'content-type: application/json' -d '{}'
check "data room created from template" $?

NODES=$($PSQL "SELECT count(*) FROM data_room_nodes n JOIN data_rooms r ON r.id=n.data_room_id WHERE r.client_id='$CID'")
[ "$(echo "$NODES" | tr -d ' ')" -ge 24 ]
check "template produced $(echo "$NODES" | tr -d ' ') items and folders" $?

echo "=== 5. planner agent"
# A finished interview takes many turns, so seed a completed profile directly
# to reach the planner, which has never run anywhere before.
$PSQL "INSERT INTO profiles (client_id, version, data, provisional_readiness_tier)
  VALUES ('$CID', 1, '{
    \"business_identity\":{\"business_description\":\"Plastic packaging manufacturer for food producers\",\"legal_form\":\"llc\",\"year_registered\":2015,\"years_operating\":11,\"employee_count\":40,\"employee_band\":\"21-49\",\"ownership\":[{\"share_pct\":100,\"active_in_business\":true,\"relationship_to_lead_owner\":\"lead owner\"}],\"owner_has_other_businesses\":false},
    \"revenue_and_customers\":{\"annual_revenue\":18000000,\"revenue_precision\":\"approximate\",\"revenue_owner_quote\":\"around 18 million a year\",\"revenue_trend_3y\":\"growing\",\"revenue_streams\":[{\"name\":\"Food packaging film\",\"share_pct\":80,\"margin_pct\":22}],\"customer_type\":\"b2b\",\"top_customer_share_pct\":35,\"contract_basis\":\"recurring_contracts\",\"seasonality\":\"mild\",\"seasonality_notes\":null},
    \"financial_health\":{\"gross_margin_pct\":22,\"net_margin_pct\":9,\"margin_precision\":\"approximate\",\"monthly_operating_cost\":1200000,\"cash_runway_months\":4,\"receivable_days\":75,\"payable_days\":45,\"inventory_days\":60,\"existing_debt\":[],\"total_monthly_debt_service\":140000,\"debt_service_precision\":\"stated\",\"statement_quality\":\"accountant_prepared\",\"latest_statement_period\":\"2025\",\"bank_relationship\":{\"primary_bank\":\"Riyad Bank\",\"years_with_bank\":8,\"revenue_through_account_pct\":95,\"avg_monthly_account_turnover\":1500000},\"compliance\":{\"zakat_status\":\"certificate_current\",\"vat_status\":\"registered_current\",\"gosi_status\":\"registered_current\",\"nitaqat_band\":\"green_medium\"}},
    \"operations\":{\"owner_dependency\":\"moderate\",\"owner_dependency_evidence\":\"Plant manager runs day to day\",\"management_team\":[{\"role\":\"Plant manager\",\"tenure_years\":6}],\"systems\":[\"accounting_software\",\"inventory\"],\"premises\":\"leased\",\"lease_expiry\":\"2028\",\"licences_held\":[\"Industrial licence\"]},
    \"market_position\":{\"geographies\":[\"Riyadh\"],\"named_competitors\":[\"Napco\"],\"differentiation\":\"Short lead times on custom film widths\",\"market_trend\":\"growing\",\"key_risks\":[\"Resin price volatility\"]},
    \"funding_need\":{\"purposes\":[\"equipment\"],\"purpose_detail\":\"Fifth extrusion line\",\"amount_requested\":6000000,\"amount_flexible\":true,\"timing\":\"3_6_months\",\"instruments_considered\":[\"bank_loan\"],\"collateral\":[{\"type\":\"Equipment\",\"estimated_value\":4000000,\"encumbered\":false}],\"personal_guarantee_willing\":true,\"previous_attempts\":[],\"use_of_funds\":[{\"item\":\"Extrusion line\",\"amount\":6000000}]},
    \"financial_records\":{\"financial_records\":[{\"id\":\"bank_statements\",\"status\":\"available\",\"period_covered\":\"12 months\",\"preparer\":\"bookkeeper\",\"notes\":null}],\"operational_records\":[],\"record_keeping_gaps\":[]},
    \"sector_detail\":{\"sector_id\":\"general\",\"inferred_business_model\":\"Converts resin into packaging film sold per tonne\",\"unit_of_sale\":\"tonne of film\",\"derived_metrics\":[{\"metric_name\":\"line utilisation\",\"question_asked\":\"How much of the time are the lines actually running?\",\"value\":\"70\",\"unit\":\"%\",\"why_it_matters\":\"Spare capacity determines whether a fifth line is justified\"}],\"sector_notes_for_reviewer\":\"Capacity-led business\"},
    \"metadata\":{\"sections_completed\":[],\"sector_id\":\"general\",\"sector_pack_version\":\"1.0.0\",\"sector_confidence\":\"medium\",\"registration_status\":\"self_declared\",\"verification_status\":\"unverified\",\"advisor_notes_for_reviewer\":\"Seeded for testing\"}
  }'::jsonb, 'near_ready')" >/dev/null
check "profile seeded" $?

# The planner now requires the advisor's planning input before it will draft
# forward-looking sections at all (no_plan_inputs) — seed it through the real
# endpoint, not a direct insert, so the endpoint itself is exercised too.
curl -sf -o /dev/null -b "$JAR" -X PATCH "$BASE/clients/$CID/plan-inputs" \
  -H 'content-type: application/json' \
  -d '{"revenue_growth_pct":12,"growth_basis":"New line adds capacity already contracted with two customers.","projection_years":3,"management_assessment":"Plant manager has run day-to-day for six years; owner is not a single point of failure.","positioning_notes":"Wins on lead time, not price.","risk_mitigants":"Two-supplier resin sourcing agreed this year.","use_of_funds_notes":"Line five only; no working-capital component."}'
check "planning input saved" $?

echo "        drafting the business plan (this takes a minute or two)..."
PLAN=$(curl -sf -m 600 -b "$JAR" -X POST "$BASE/clients/$CID/plans" \
  -H 'content-type: application/json' -d '{}')
check "planner ran" $?
echo "        $PLAN"

PLAN_ID=$(echo "$PLAN" | grep -o '"plan_id":"[^"]*' | cut -d'"' -f4)

SECTIONS=$($PSQL "SELECT count(*) FROM plan_sections s JOIN plans p ON p.id=s.plan_id WHERE p.client_id='$CID' AND s.content <> ''")
[ "$(echo "$SECTIONS" | tr -d ' ')" -ge 5 ]
check "$(echo "$SECTIONS" | tr -d ' ') sections drafted with content" $?

GAPS=$($PSQL "SELECT count(*) FROM plan_gaps g JOIN plans p ON p.id=g.plan_id WHERE p.client_id='$CID'")
echo "        gaps raised for the client: $(echo "$GAPS" | tr -d ' ')"

PROV=$($PSQL "SELECT count(*) FROM plan_sections s JOIN plans p ON p.id=s.plan_id WHERE p.client_id='$CID' AND jsonb_array_length(s.provenance) > 0")
[ "$(echo "$PROV" | tr -d ' ')" -ge 1 ]
check "$(echo "$PROV" | tr -d ' ') sections carry sourced statements" $?

FIN=$($PSQL "SELECT count(*) FROM plan_financials WHERE plan_id='$PLAN_ID'")
[ "$(echo "$FIN" | tr -d ' ')" -ge 1 ]
check "$(echo "$FIN" | tr -d ' ') financial projection rows computed" $?

echo "=== 6. approval gate"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/plans/$PLAN_ID/export")
[ "$STATUS" = "409" ]
check "export blocked before approval (got $STATUS)" $?

curl -sf -o /dev/null -b "$JAR" -X POST "$BASE/plans/$PLAN_ID/approve"
check "plan approved" $?

MD_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/plans/$PLAN_ID/export")
[ "$MD_STATUS" = "200" ]
check "markdown export available after approval (got $MD_STATUS)" $?

DOCX_FILE=$(mktemp)
curl -sf -b "$JAR" "$BASE/plans/$PLAN_ID/export.docx?audience=lender" -o "$DOCX_FILE"
DOCX_BYTES=$(wc -c < "$DOCX_FILE")
[ "$DOCX_BYTES" -ge 5000 ]
check "Word export produced a real document ($DOCX_BYTES bytes)" $?
rm -f "$DOCX_FILE"

rm -f "$JAR"
echo
echo "=== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
