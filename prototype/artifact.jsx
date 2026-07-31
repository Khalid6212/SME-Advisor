// GENERATED FILE — do not edit.
// Built from src/core and src/sectors by scripts/build-prototype.mjs.
// Edit the source and re-run `npm run build:prototype`.
//
// Phase 1 throwaway prototype. Runs in the Claude artifact sandbox, which
// injects API auth and provides window.storage. It will NOT run anywhere else.
//
// It exists to answer one question: does the _general pack produce genuinely
// operator-shaped derived metrics across unrelated businesses, or generic ones?

import { useState, useEffect, useRef } from "react";

const BUILD = {
  "generatedAt": "2026-07-31T18:48:07.441Z",
  "packId": "general",
  "packVersion": "1.0.0"
};
const MODEL = "claude-opus-5";
const SYSTEM_PROMPT = "You are an investment readiness advisor for small and medium enterprises in Saudi Arabia. You help owners of operating businesses understand where they stand and prepare for financing — bank facilities, guarantee-backed lending, government programmes, equipment leasing, trade finance, or growth equity.\n\nYour clients run real businesses with revenue and customers. They are not startups and you are not a startup mentor. Do not talk about pitch decks, runway to Series A, or product-market fit.\n\n## Your task\n\nConduct a structured discovery interview, section by section, then submit a structured profile for review by an investment manager.\n\nSections, in order:\n1. BUSINESS IDENTITY\n2. REVENUE & CUSTOMERS\n3. FINANCIAL HEALTH\n4. OPERATIONS\n5. MARKET POSITION\n6. FUNDING NEED\n7. FINANCIAL RECORDS\n\n## How to ask\n\n- Two to three questions at a time. Never a wall of questions.\n- Plain language. Most owners are not finance-trained. If you must use a technical term, define it in the same sentence — once, not every time.\n- Accept approximate numbers. \"Around 400,000 a month\" is a usable answer. Never stall an interview demanding precision.\n- Ask a follow-up when an answer is vague on something that matters. One follow-up, then move on and record it as a gap.\n- After each section, summarise what you heard in three or four lines and ask them to correct anything wrong.\n- If they volunteer information belonging to a later section, record it and do not ask again.\n- Match their language. If they write in Arabic, answer in Arabic.\n\n## Things owners find hard to answer, and how to ask instead\n\n- Owner dependency → \"If you travelled for a month with no phone, what would break first?\"\n- Margins → \"On a typical 1,000 riyals of sales, roughly how much is left after direct costs?\"\n- Cash cycle → \"From doing the work to money in the account — how long?\"\n- Concentration → \"If your biggest customer left tomorrow, how much revenue goes with them?\"\n- Account turnover → \"Roughly what share of your sales goes through the business bank account, rather than cash?\"\n\n## Tone\n\nDirect, practical, warm. You respect that they know their business better than you do. Use Arabic terms naturally where they are the words people actually use (السجل التجاري، شهادة الزكاة، الضريبة، منشآت، كفالة، نطاقات).\n\nBe honest about weaknesses and always pair them with a fix. \"Your books aren't at the level most banks want yet — that's fixable in about a month with a proper bookkeeper\" is useful. Vague reassurance is not.\n\nNever promise approval, quote rates or terms, or state that they qualify for a specific programme. Eligibility is assessed separately.\n\n## What you ask for, and what you never ask for\n\nYou ask questions. You do not collect documents of any kind at this stage — not financial statements, not bank statements, not the commercial registration, not certificates, not contracts, not identity documents.\n\nIf the owner offers to send something, thank them and tell them it isn't needed yet — their advisor will handle anything like that directly at the next stage. Say the scope plainly the first time documents come up:\n\n  \"At this stage it's just questions — no documents, no certificates, nothing to upload.\"\n\n## Registration and compliance\n\nAsk these conversationally in Section 1 and Section 3. Record them as self-reported. Never ask for the underlying document.\n\n- Legal form (مؤسسة فردية، شركة ذات مسؤولية محدودة، …) and the year they registered\n- Zakat standing — is the certificate current, filed and pending, overdue, or not registered\n- VAT registration status\n- GOSI registration, and Nitaqat band if they employ staff\n\nIf they don't know a status, record \"unknown\" and move on. Do not press.\n\n## Recording what you learn\n\n- Call `save_section` at the end of each section, with everything captured so far for that section. Do this even if the section is incomplete.\n- Call `submit_profile` only when all seven sections are done.\n- If the owner cannot or will not answer something, record it as null with a note. Never invent a plausible value. A gap you flagged is far more useful than a number you guessed.\n- Record only what they told you. Do not record inferences as facts.\n- For every material figure, capture the owner's own words in `owner_quote`. The reviewer needs to see how the number was stated, not just the number.\n\n\n## Sector-specific probing\n\nNo pre-built module exists for this business type, so you derive the sector-specific questions yourself.\n\nAfter Section 1, before starting Section 2, work out privately:\n- How does this business actually make money? What is the unit it sells — a job, an hour, a cover, a delivery, a unit, a subscription, a contract?\n- What are the three or four numbers an operator in this line of business would use to judge whether it is running well?\n- What is the single biggest thing that goes wrong in this kind of business?\n\nThen weave three to five questions on those into Sections 2 and 3. Do not announce that you are doing this, and do not present them as a separate block — they belong inside the normal flow of the conversation.\n\nRecord each one via `save_section` under `derived_metrics`:\n  { metric_name, question_asked, value, unit, why_it_matters }\n\nUse the operator's own vocabulary for `metric_name`. If they say \"covers\", record \"covers\" — not \"customer transactions\". The point of this field is to capture how people in this line of work actually talk, so leave their words intact.\n\nIf the business genuinely does not fit a recognisable pattern, say so plainly and ask them how they judge whether a month went well. Their answer is usually the metric.";
const TOOLS = [
  {
    "name": "save_section",
    "description": "Record everything captured for one section. Call this at the end of each section, even if the section is incomplete. Fields the owner did not answer should be null.",
    "input_schema": {
      "type": "object",
      "properties": {
        "section_id": {
          "type": "string",
          "enum": [
            "business_identity",
            "revenue_and_customers",
            "financial_health",
            "operations",
            "market_position",
            "funding_need",
            "financial_records"
          ]
        },
        "complete": {
          "type": "boolean",
          "description": "Whether this section met its completion bar, or was left with gaps."
        },
        "data": {
          "type": "object",
          "description": "Partial section data matching the profile schema for this section."
        },
        "gaps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "field": {
                "type": "string"
              },
              "reason": {
                "type": "string",
                "enum": [
                  "owner_did_not_know",
                  "owner_declined",
                  "not_applicable",
                  "ran_out_of_time"
                ]
              },
              "note": {
                "type": "string"
              }
            },
            "required": [
              "field",
              "reason"
            ]
          }
        }
      },
      "required": [
        "section_id",
        "complete",
        "data"
      ]
    }
  },
  {
    "name": "submit_profile",
    "description": "Submit the completed profile for review. Call this only when all seven sections are done. Along with the profile, record a claims ledger: every statement a reviewer would want checked before relying on it.",
    "strict": true,
    "input_schema": {
      "type": "object",
      "properties": {
        "profile": {
          "type": "object",
          "properties": {
            "business_identity": {
              "type": "object",
              "properties": {
                "business_description": {
                  "type": "string",
                  "description": "In the owner's own words, what the business does."
                },
                "legal_form": {
                  "type": "string",
                  "enum": [
                    "sole_proprietorship",
                    "llc",
                    "closed_joint_stock",
                    "partnership",
                    "branch_of_foreign",
                    "freelance_certificate",
                    "unregistered",
                    "other",
                    "unknown"
                  ]
                },
                "year_registered": {
                  "type": [
                    "integer",
                    "null"
                  ],
                  "description": "Gregorian year. Self-reported."
                },
                "years_operating": {
                  "type": [
                    "integer",
                    "null"
                  ],
                  "description": "May predate registration — ask separately if they differ."
                },
                "employee_count": {
                  "type": [
                    "integer",
                    "null"
                  ]
                },
                "employee_band": {
                  "type": "string",
                  "enum": [
                    "1-5",
                    "6-20",
                    "21-49",
                    "50-99",
                    "100-249",
                    "250+"
                  ]
                },
                "ownership": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "share_pct": {
                        "type": "number"
                      },
                      "active_in_business": {
                        "type": "boolean"
                      },
                      "relationship_to_lead_owner": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "description": "e.g. 'brother', 'silent partner'. Never record names."
                      }
                    },
                    "required": [
                      "share_pct",
                      "active_in_business",
                      "relationship_to_lead_owner"
                    ],
                    "additionalProperties": false
                  },
                  "description": "Structure only. Do not record owner names or identity references."
                },
                "owner_has_other_businesses": {
                  "type": [
                    "boolean",
                    "null"
                  ]
                }
              },
              "required": [
                "business_description",
                "legal_form",
                "year_registered",
                "years_operating",
                "employee_count",
                "employee_band",
                "ownership",
                "owner_has_other_businesses"
              ],
              "additionalProperties": false
            },
            "revenue_and_customers": {
              "type": "object",
              "properties": {
                "annual_revenue": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "SAR."
                },
                "revenue_precision": {
                  "type": "string",
                  "enum": [
                    "stated",
                    "approximate",
                    "range",
                    "estimated_by_advisor",
                    "declined"
                  ]
                },
                "revenue_owner_quote": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "How the owner stated it, verbatim."
                },
                "revenue_trend_3y": {
                  "type": "string",
                  "enum": [
                    "growing_strongly",
                    "growing",
                    "flat",
                    "declining",
                    "volatile",
                    "unknown"
                  ]
                },
                "revenue_streams": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string"
                      },
                      "share_pct": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "margin_pct": {
                        "type": [
                          "number",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "name",
                      "share_pct",
                      "margin_pct"
                    ],
                    "additionalProperties": false
                  }
                },
                "customer_type": {
                  "type": "string",
                  "enum": [
                    "b2c",
                    "b2b",
                    "government",
                    "mixed"
                  ]
                },
                "top_customer_share_pct": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "Revenue concentration. Among the highest-value fields here."
                },
                "contract_basis": {
                  "type": "string",
                  "enum": [
                    "recurring_contracts",
                    "repeat_no_contract",
                    "project_based",
                    "walk_in",
                    "mixed"
                  ]
                },
                "seasonality": {
                  "type": "string",
                  "enum": [
                    "none",
                    "mild",
                    "strong",
                    "unknown"
                  ]
                },
                "seasonality_notes": {
                  "type": [
                    "string",
                    "null"
                  ]
                }
              },
              "required": [
                "annual_revenue",
                "revenue_precision",
                "revenue_owner_quote",
                "revenue_trend_3y",
                "revenue_streams",
                "customer_type",
                "top_customer_share_pct",
                "contract_basis",
                "seasonality",
                "seasonality_notes"
              ],
              "additionalProperties": false
            },
            "financial_health": {
              "type": "object",
              "properties": {
                "gross_margin_pct": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "net_margin_pct": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "margin_precision": {
                  "type": "string",
                  "enum": [
                    "stated",
                    "approximate",
                    "range",
                    "estimated_by_advisor",
                    "declined"
                  ]
                },
                "monthly_operating_cost": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "SAR."
                },
                "cash_runway_months": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "receivable_days": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "payable_days": {
                  "type": [
                    "number",
                    "null"
                  ]
                },
                "inventory_days": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "Null for service businesses — not a gap."
                },
                "existing_debt": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "lender": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "facility_type": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "outstanding": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "monthly_payment": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "maturity_date": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "secured_by": {
                        "type": [
                          "string",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "lender",
                      "facility_type",
                      "outstanding",
                      "monthly_payment",
                      "maturity_date",
                      "secured_by"
                    ],
                    "additionalProperties": false
                  }
                },
                "total_monthly_debt_service": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "SAR."
                },
                "debt_service_precision": {
                  "type": "string",
                  "enum": [
                    "stated",
                    "approximate",
                    "range",
                    "estimated_by_advisor",
                    "declined"
                  ]
                },
                "statement_quality": {
                  "type": "string",
                  "enum": [
                    "audited",
                    "reviewed",
                    "accountant_prepared",
                    "bookkeeping_software",
                    "spreadsheets",
                    "none"
                  ],
                  "description": "Determines which products are open to them."
                },
                "latest_statement_period": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "bank_relationship": {
                  "type": "object",
                  "properties": {
                    "primary_bank": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "years_with_bank": {
                      "type": [
                        "number",
                        "null"
                      ]
                    },
                    "revenue_through_account_pct": {
                      "type": [
                        "number",
                        "null"
                      ],
                      "description": "Lenders weight declared turnover heavily."
                    },
                    "avg_monthly_account_turnover": {
                      "type": [
                        "number",
                        "null"
                      ]
                    }
                  },
                  "required": [
                    "primary_bank",
                    "years_with_bank",
                    "revenue_through_account_pct",
                    "avg_monthly_account_turnover"
                  ],
                  "additionalProperties": false
                },
                "compliance": {
                  "type": "object",
                  "properties": {
                    "zakat_status": {
                      "type": "string",
                      "enum": [
                        "certificate_current",
                        "filed_pending",
                        "overdue",
                        "not_registered",
                        "unknown"
                      ]
                    },
                    "vat_status": {
                      "type": "string",
                      "enum": [
                        "registered_current",
                        "registered_overdue",
                        "below_threshold",
                        "not_registered",
                        "unknown"
                      ]
                    },
                    "gosi_status": {
                      "type": "string",
                      "enum": [
                        "registered_current",
                        "registered_arrears",
                        "not_registered",
                        "unknown"
                      ]
                    },
                    "nitaqat_band": {
                      "type": "string",
                      "enum": [
                        "platinum",
                        "green_high",
                        "green_medium",
                        "green_low",
                        "red",
                        "not_applicable",
                        "unknown"
                      ]
                    }
                  },
                  "required": [
                    "zakat_status",
                    "vat_status",
                    "gosi_status",
                    "nitaqat_band"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "gross_margin_pct",
                "net_margin_pct",
                "margin_precision",
                "monthly_operating_cost",
                "cash_runway_months",
                "receivable_days",
                "payable_days",
                "inventory_days",
                "existing_debt",
                "total_monthly_debt_service",
                "debt_service_precision",
                "statement_quality",
                "latest_statement_period",
                "bank_relationship",
                "compliance"
              ],
              "additionalProperties": false
            },
            "operations": {
              "type": "object",
              "properties": {
                "owner_dependency": {
                  "type": "string",
                  "enum": [
                    "critical",
                    "high",
                    "moderate",
                    "low"
                  ]
                },
                "owner_dependency_evidence": {
                  "type": "string",
                  "description": "Their answer to the 30-day question, in their words."
                },
                "management_team": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "role": {
                        "type": "string"
                      },
                      "tenure_years": {
                        "type": [
                          "number",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "role",
                      "tenure_years"
                    ],
                    "additionalProperties": false
                  }
                },
                "systems": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "pos",
                      "accounting_software",
                      "erp",
                      "crm",
                      "inventory",
                      "none"
                    ]
                  }
                },
                "premises": {
                  "type": "string",
                  "enum": [
                    "owned",
                    "leased",
                    "home_based",
                    "mobile",
                    "none"
                  ]
                },
                "lease_expiry": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "Self-reported date. Do not ask for the lease."
                },
                "licences_held": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Names only, self-reported. Never request the documents."
                  }
                }
              },
              "required": [
                "owner_dependency",
                "owner_dependency_evidence",
                "management_team",
                "systems",
                "premises",
                "lease_expiry",
                "licences_held"
              ],
              "additionalProperties": false
            },
            "market_position": {
              "type": "object",
              "properties": {
                "geographies": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "named_competitors": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "differentiation": {
                  "type": "string"
                },
                "market_trend": {
                  "type": "string",
                  "enum": [
                    "growing",
                    "stable",
                    "contracting",
                    "uncertain"
                  ]
                },
                "key_risks": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "geographies",
                "named_competitors",
                "differentiation",
                "market_trend",
                "key_risks"
              ],
              "additionalProperties": false
            },
            "funding_need": {
              "type": "object",
              "properties": {
                "purposes": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "working_capital",
                      "equipment",
                      "new_location",
                      "inventory",
                      "refinancing",
                      "contract_execution",
                      "real_estate",
                      "hiring",
                      "technology",
                      "other"
                    ]
                  }
                },
                "purpose_detail": {
                  "type": "string"
                },
                "amount_requested": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "SAR."
                },
                "amount_flexible": {
                  "type": [
                    "boolean",
                    "null"
                  ]
                },
                "timing": {
                  "type": "string",
                  "enum": [
                    "immediate",
                    "1_3_months",
                    "3_6_months",
                    "6_months_plus"
                  ]
                },
                "instruments_considered": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "bank_loan",
                      "guarantee_backed",
                      "government_grant",
                      "equipment_lease",
                      "trade_finance",
                      "pos_financing",
                      "equity",
                      "unsure"
                    ]
                  }
                },
                "collateral": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string"
                      },
                      "estimated_value": {
                        "type": [
                          "number",
                          "null"
                        ]
                      },
                      "encumbered": {
                        "type": [
                          "boolean",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "estimated_value",
                      "encumbered"
                    ],
                    "additionalProperties": false
                  }
                },
                "personal_guarantee_willing": {
                  "type": [
                    "boolean",
                    "null"
                  ]
                },
                "previous_attempts": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "institution": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "year": {
                        "type": [
                          "integer",
                          "null"
                        ]
                      },
                      "outcome": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "stated_reason": {
                        "type": [
                          "string",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "institution",
                      "year",
                      "outcome",
                      "stated_reason"
                    ],
                    "additionalProperties": false
                  }
                },
                "use_of_funds": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "item": {
                        "type": "string"
                      },
                      "amount": {
                        "type": [
                          "number",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "item",
                      "amount"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "purposes",
                "purpose_detail",
                "amount_requested",
                "amount_flexible",
                "timing",
                "instruments_considered",
                "collateral",
                "personal_guarantee_willing",
                "previous_attempts",
                "use_of_funds"
              ],
              "additionalProperties": false
            },
            "financial_records": {
              "type": "object",
              "properties": {
                "financial_records": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "enum": [
                          "bank_statements",
                          "financial_statements",
                          "management_accounts",
                          "aged_receivables",
                          "aged_payables",
                          "debt_schedule"
                        ]
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "available",
                          "partial",
                          "not_kept",
                          "declined",
                          "unknown"
                        ]
                      },
                      "period_covered": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "preparer": {
                        "type": "string",
                        "enum": [
                          "external_auditor",
                          "accounting_firm",
                          "in_house_accountant",
                          "bookkeeper",
                          "owner",
                          "none"
                        ]
                      },
                      "notes": {
                        "type": [
                          "string",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "id",
                      "status",
                      "period_covered",
                      "preparer",
                      "notes"
                    ],
                    "additionalProperties": false
                  },
                  "description": "What records exist and at what quality. Nothing is collected at this stage."
                },
                "operational_records": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "description": {
                        "type": "string",
                        "description": "e.g. 'POS daily sales export', 'project backlog sheet'."
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "available",
                          "partial",
                          "not_kept",
                          "declined",
                          "unknown"
                        ]
                      },
                      "notes": {
                        "type": [
                          "string",
                          "null"
                        ]
                      }
                    },
                    "required": [
                      "description",
                      "status",
                      "notes"
                    ],
                    "additionalProperties": false
                  }
                },
                "record_keeping_gaps": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "gap": {
                        "type": "string"
                      },
                      "impact_on_readiness": {
                        "type": "string"
                      },
                      "how_to_fix": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "gap",
                      "impact_on_readiness",
                      "how_to_fix"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "financial_records",
                "operational_records",
                "record_keeping_gaps"
              ],
              "additionalProperties": false
            },
            "sector_detail": {
              "type": "object",
              "properties": {
                "sector_id": {
                  "type": "string",
                  "const": "general"
                },
                "inferred_business_model": {
                  "type": "string",
                  "description": "One or two sentences. How this business makes money."
                },
                "unit_of_sale": {
                  "type": "string",
                  "description": "The thing it sells one of — a job, an hour, a cover, a delivery, a unit, a contract."
                },
                "derived_metrics": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "metric_name": {
                        "type": "string",
                        "description": "In the operator's own vocabulary, not normalised."
                      },
                      "question_asked": {
                        "type": "string"
                      },
                      "value": {
                        "type": [
                          "string",
                          "number",
                          "null"
                        ]
                      },
                      "unit": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "why_it_matters": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "metric_name",
                      "question_asked",
                      "value",
                      "unit",
                      "why_it_matters"
                    ],
                    "additionalProperties": false
                  }
                },
                "sector_notes_for_reviewer": {
                  "type": "string",
                  "description": "Anything about this business type the reviewer would not infer from the core fields."
                }
              },
              "required": [
                "sector_id",
                "inferred_business_model",
                "unit_of_sale",
                "derived_metrics",
                "sector_notes_for_reviewer"
              ],
              "additionalProperties": false
            },
            "metadata": {
              "type": "object",
              "properties": {
                "sections_completed": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "sector_id": {
                  "type": "string"
                },
                "sector_pack_version": {
                  "type": "string"
                },
                "sector_confidence": {
                  "type": "string",
                  "enum": [
                    "high",
                    "medium",
                    "low"
                  ]
                },
                "registration_status": {
                  "type": "string",
                  "enum": [
                    "self_declared",
                    "not_provided"
                  ]
                },
                "verification_status": {
                  "type": "string",
                  "enum": [
                    "unverified"
                  ],
                  "description": "Always 'unverified' at this stage."
                },
                "advisor_notes_for_reviewer": {
                  "type": "string",
                  "description": "Anything the reviewer should know that the fields do not carry."
                }
              },
              "required": [
                "sections_completed",
                "sector_id",
                "sector_pack_version",
                "sector_confidence",
                "registration_status",
                "verification_status",
                "advisor_notes_for_reviewer"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "business_identity",
            "revenue_and_customers",
            "financial_health",
            "operations",
            "market_position",
            "funding_need",
            "financial_records",
            "sector_detail",
            "metadata"
          ],
          "additionalProperties": false
        },
        "claims": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "claim_id": {
                "type": "string"
              },
              "field_path": {
                "type": "string",
                "description": "Dotted path into the profile, e.g. 'financial_health.total_monthly_debt_service'."
              },
              "stated_value": {
                "type": [
                  "string",
                  "number",
                  "null"
                ]
              },
              "precision": {
                "type": "string",
                "enum": [
                  "stated",
                  "approximate",
                  "range",
                  "estimated_by_advisor",
                  "declined"
                ]
              },
              "owner_quote": {
                "type": "string",
                "description": "What the owner actually said, verbatim. The reviewer needs to see how the number was stated."
              },
              "materiality": {
                "type": "string",
                "enum": [
                  "high",
                  "medium",
                  "low"
                ],
                "description": "How much this claim moves the funding decision. Revenue, debt service, customer concentration and account turnover are high. Competitor names and market trend are low."
              },
              "verifiable_by": {
                "type": "array",
                "items": {
                  "type": "string",
                  "enum": [
                    "bank_statements",
                    "financial_statements",
                    "management_accounts",
                    "aged_receivables",
                    "aged_payables",
                    "debt_schedule",
                    "sales_export",
                    "inventory_report",
                    "capacity_log",
                    "project_backlog",
                    "commercial_registration",
                    "articles_of_association",
                    "zakat_certificate",
                    "vat_certificate",
                    "gosi_certificate",
                    "nitaqat_certificate",
                    "customer_contract",
                    "supplier_agreement",
                    "lease_agreement",
                    "none"
                  ]
                },
                "description": "Document types that would settle this claim. Use ['none'] where nothing would."
              },
              "verification_status": {
                "type": "string",
                "enum": [
                  "unverified"
                ]
              }
            },
            "required": [
              "claim_id",
              "field_path",
              "stated_value",
              "precision",
              "owner_quote",
              "materiality",
              "verifiable_by",
              "verification_status"
            ],
            "additionalProperties": false
          },
          "description": "Every material claim made during the interview. Do not create a claim for every field — only for statements a reviewer would want checked before relying on them."
        }
      },
      "required": [
        "profile",
        "claims"
      ],
      "additionalProperties": false
    }
  }
];
const SECTION_ORDER = [
  "business_identity",
  "revenue_and_customers",
  "financial_health",
  "operations",
  "market_position",
  "funding_need",
  "financial_records"
];

const SECTION_LABELS = {
  business_identity: "Business identity",
  revenue_and_customers: "Revenue & customers",
  financial_health: "Financial health",
  operations: "Operations",
  market_position: "Market position",
  funding_need: "Funding need",
  financial_records: "Financial records",
};

const C = {
  bg: "#11111b", panel: "#1e1e2e", line: "#313244", text: "#cdd6f4",
  dim: "#a6adc8", faint: "#6c7086", accent: "#1a5c3a", good: "#a6e3a1",
  info: "#89b4fa", warn: "#f9e2af",
};

const STORAGE_KEY = "sme-advisor-prototype-v1";

async function loadState() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function saveState(state) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error("storage failed", e); }
}

// ─── agent loop ─────────────────────────────────────────────────────────────

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Run turns until the model stops calling tools.
 *
 * save_section is acknowledged and the draft is merged. submit_profile ends the
 * interview — that is the completion signal, not a parsed JSON fence.
 */
async function runTurn(messages, onSection, onSubmit) {
  let history = [...messages];

  for (let i = 0; i < 8; i++) {
    const res = await callClaude(history);
    history.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) return { history, done: false };

    const results = [];
    for (const call of toolUses) {
      if (call.name === "save_section") {
        onSection(call.input);
        results.push({
          type: "tool_result", tool_use_id: call.id,
          content: `Saved ${call.input.section_id}.`,
        });
      } else if (call.name === "submit_profile") {
        onSubmit(call.input);
        return { history, done: true };
      } else {
        results.push({
          type: "tool_result", tool_use_id: call.id,
          content: `Unknown tool ${call.name}.`, is_error: true,
        });
      }
    }
    history.push({ role: "user", content: results });
  }
  return { history, done: false };
}

// ─── components ─────────────────────────────────────────────────────────────

function Bubble({ role, text }) {
  const mine = role === "user";
  return (
    <div style={{
      display: "flex", justifyContent: mine ? "flex-end" : "flex-start",
      marginBottom: 12, paddingLeft: mine ? 48 : 0, paddingRight: mine ? 0 : 48,
    }}>
      <div dir="auto" style={{
        background: mine ? C.accent : C.panel,
        color: mine ? "#e8f5e9" : C.text,
        border: mine ? "none" : `1px solid ${C.line}`,
        padding: "12px 16px", fontSize: 14, lineHeight: 1.65,
        whiteSpace: "pre-wrap", maxWidth: "100%",
        borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
      }}>{text}</div>
    </div>
  );
}

function Progress({ saved }) {
  return (
    <div style={{
      display: "flex", gap: 4, padding: "10px 16px",
      borderBottom: `1px solid ${C.line}`, background: C.bg, flexShrink: 0,
    }}>
      {SECTION_ORDER.map((id) => {
        const s = saved[id];
        const color = !s ? C.line : s.complete ? C.good : C.warn;
        return (
          <div key={id} title={SECTION_LABELS[id]} style={{ flex: 1 }}>
            <div style={{ height: 3, background: color, borderRadius: 2 }} />
            <div style={{ fontSize: 9, color: C.faint, marginTop: 4, textAlign: "center" }}>
              {SECTION_LABELS[id].split(" ")[0]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Results({ result, onReset }) {
  const profile = result?.profile ?? {};
  const claims = result?.claims ?? [];
  const sector = profile.sector_detail ?? {};
  const metrics = sector.derived_metrics ?? [];
  const [tab, setTab] = useState("metrics");

  const copy = () => navigator.clipboard?.writeText(JSON.stringify(result, null, 2));

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{
        padding: 16, marginBottom: 20, background: "#1a5c3a22",
        border: `1px solid #1a5c3a55`, borderRadius: 12,
      }}>
        <div style={{ color: C.good, fontWeight: 600, marginBottom: 6 }}>
          ✓ Interview complete
        </div>
        <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5 }}>
          This is the experiment's output. Read the derived metrics below — are they
          specific to how this business actually operates, in the owner's own words?
          Or are they generic ("monthly revenue", "number of customers")?
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["metrics", "claims", "json"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${tab === t ? C.info : C.line}`,
            background: tab === t ? "#89b4fa22" : "transparent",
            color: tab === t ? C.info : C.faint, fontSize: 12, fontWeight: 600,
            textTransform: "capitalize",
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={copy} style={{
          padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.line}`,
          background: "transparent", color: C.dim, fontSize: 12, cursor: "pointer",
        }}>Copy JSON</button>
        <button onClick={onReset} style={{
          padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.line}`,
          background: "transparent", color: C.faint, fontSize: 12, cursor: "pointer",
        }}>New interview</button>
      </div>

      {tab === "metrics" && (
        <div>
          <Field label="Inferred business model" value={sector.inferred_business_model} />
          <Field label="Unit of sale" value={sector.unit_of_sale} />
          <div style={{ color: C.faint, fontSize: 11, textTransform: "uppercase",
                        letterSpacing: 1, margin: "20px 0 8px" }}>
            Derived metrics ({metrics.length})
          </div>
          {metrics.length === 0 && (
            <div style={{ color: C.warn, fontSize: 13 }}>
              None recorded — the probe mechanism did not fire. That is a finding.
            </div>
          )}
          {metrics.map((m, i) => (
            <div key={i} style={{
              background: C.panel, border: `1px solid ${C.line}`,
              borderRadius: 10, padding: 14, marginBottom: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>
                  {m.metric_name}
                </span>
                <span style={{ color: C.good, fontSize: 14, whiteSpace: "nowrap" }}>
                  {m.value ?? "—"} {m.unit ?? ""}
                </span>
              </div>
              <div dir="auto" style={{ color: C.dim, fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
                "{m.question_asked}"
              </div>
              <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>
                {m.why_it_matters}
              </div>
            </div>
          ))}
          {sector.sector_notes_for_reviewer && (
            <Field label="Notes for reviewer" value={sector.sector_notes_for_reviewer} />
          )}
        </div>
      )}

      {tab === "claims" && (
        <div>
          <div style={{ color: C.faint, fontSize: 12, marginBottom: 12 }}>
            {claims.filter((c) => c.materiality === "high").length} high-materiality
            of {claims.length} total. These drive the verification agent's document request.
          </div>
          {claims.map((c, i) => (
            <div key={i} style={{
              background: C.panel, border: `1px solid ${C.line}`,
              borderRadius: 10, padding: 12, marginBottom: 6, fontSize: 13,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700,
                  background: c.materiality === "high" ? "#f38ba822" : "#6c708622",
                  color: c.materiality === "high" ? "#f38ba8" : C.faint,
                  textTransform: "uppercase",
                }}>{c.materiality}</span>
                <span style={{ color: C.dim, fontFamily: "monospace", fontSize: 11 }}>
                  {c.field_path}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ color: C.text }}>{String(c.stated_value ?? "—")}</span>
              </div>
              <div dir="auto" style={{ color: C.faint, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                "{c.owner_quote}"
              </div>
              <div style={{ color: C.info, fontSize: 11, marginTop: 4 }}>
                verify via {c.verifiable_by?.join(", ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "json" && (
        <pre style={{
          color: C.text, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap",
          wordBreak: "break-word", background: C.panel, padding: 16,
          borderRadius: 10, border: `1px solid ${C.line}`,
        }}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: C.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div dir="auto" style={{ color: C.text, fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>
        {value}
      </div>
    </div>
  );
}

// ─── app ────────────────────────────────────────────────────────────────────

export default function App() {
  const [messages, setMessages] = useState([]);
  const [saved, setSaved] = useState({});
  const [result, setResult] = useState(null);
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    loadState().then((s) => {
      if (s) { setMessages(s.messages ?? []); setSaved(s.saved ?? {}); setResult(s.result ?? null); }
      setReady(true);
    });
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const persist = (m, s, r) => saveState({ messages: m, saved: s, result: r, build: BUILD });

  async function advance(nextMessages) {
    setBusy(true);
    setError(null);
    const nextSaved = { ...saved };
    let submitted = null;
    try {
      const { history } = await runTurn(
        nextMessages,
        (input) => { nextSaved[input.section_id] = input; },
        (input) => { submitted = input; },
      );
      setMessages(history);
      setSaved(nextSaved);
      if (submitted) setResult(submitted);
      persist(history, nextSaved, submitted);
    } catch (e) {
      setError(String(e.message ?? e));
      setMessages(nextMessages);
    }
    setBusy(false);
  }

  const start = () => {
    if (!brief.trim()) return;
    advance([{ role: "user", content: brief.trim() }]);
  };

  const send = () => {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user", content: input.trim() }];
    setInput("");
    advance(next);
  };

  const reset = async () => {
    setMessages([]); setSaved({}); setResult(null); setBrief(""); setError(null);
    await saveState({ messages: [], saved: {}, result: null, build: BUILD });
  };

  const shell = {
    height: "100vh", display: "flex", flexDirection: "column",
    background: C.bg, fontFamily: "'Inter', system-ui, sans-serif",
  };

  if (!ready) {
    return <div style={{ ...shell, alignItems: "center", justifyContent: "center", color: C.faint }}>
      Loading…
    </div>;
  }

  if (messages.length === 0) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            مستشار الجاهزية الاستثمارية
          </div>
          <div style={{ fontSize: 15, color: C.dim, marginBottom: 14 }}>
            SME Investment Readiness — prototype
          </div>
          <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.6 }}>
            Just questions. No documents, no certificates, nothing to upload.
            Tell us what your business does and we'll take it from there.
          </div>
        </div>
        <textarea
          value={brief} onChange={(e) => setBrief(e.target.value)} dir="auto"
          placeholder="e.g. We run two auto workshops in Dammam, mostly fleet contracts…"
          style={{
            width: "100%", maxWidth: 460, minHeight: 90, padding: "12px 14px",
            borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel,
            color: C.text, fontSize: 14, outline: "none", resize: "vertical",
            fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
        <button onClick={start} disabled={!brief.trim()} style={{
          padding: "12px 32px", borderRadius: 12, border: "none",
          background: brief.trim() ? C.accent : C.line, color: "#fff",
          fontSize: 15, fontWeight: 600, cursor: brief.trim() ? "pointer" : "default",
        }}>Start</button>
        <div style={{ fontSize: 10, color: C.faint }}>
          {BUILD.packId} v{BUILD.packVersion} · {MODEL}
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <Progress saved={saved} />
      {result ? (
        <Results result={result} onReset={reset} />
      ) : (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px" }}>
            {messages.map((m, i) => {
              const text = typeof m.content === "string"
                ? m.content
                : m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
              if (!text.trim()) return null;
              return <Bubble key={i} role={m.role} text={text} />;
            })}
            {busy && (
              <div style={{
                display: "inline-block", background: C.panel, border: `1px solid ${C.line}`,
                padding: "12px 16px", borderRadius: "18px 18px 18px 4px", color: C.faint, fontSize: 14,
              }}>Thinking…</div>
            )}
            {error && (
              <div style={{
                background: "#f38ba822", border: "1px solid #f38ba855", color: "#f38ba8",
                padding: 12, borderRadius: 10, fontSize: 13, marginTop: 12,
              }}>
                {error}
                <button onClick={() => advance(messages)} style={{
                  marginLeft: 10, background: "none", border: "none",
                  color: C.info, cursor: "pointer", fontSize: 13, textDecoration: "underline",
                }}>Retry</button>
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div style={{
            padding: "12px 16px", borderTop: `1px solid ${C.line}`,
            display: "flex", gap: 8, background: C.bg, flexShrink: 0,
          }}>
            <input
              value={input} onChange={(e) => setInput(e.target.value)} dir="auto"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !busy && (e.preventDefault(), send())}
              placeholder="Your answer…" disabled={busy}
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                border: `1px solid ${C.line}`, background: C.panel,
                color: C.text, fontSize: 14, outline: "none",
              }}
            />
            <button onClick={send} disabled={busy || !input.trim()} style={{
              padding: "10px 20px", borderRadius: 12, border: "none",
              background: busy || !input.trim() ? C.line : C.accent,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: busy ? "default" : "pointer",
            }}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
