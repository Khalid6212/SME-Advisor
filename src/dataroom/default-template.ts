/**
 * Default SME lending data room.
 *
 * ⚠️ DRAFT — have this reviewed by someone who submits these files weekly
 * before it goes in front of clients. Document names, issuing authorities, and
 * which items lenders actually insist on are the parts most likely to be wrong,
 * and a wrong document name in a client-facing checklist is an avoidable
 * credibility hit.
 *
 * This is the *verification* stage, so certificates and contracts are in scope
 * here even though the interview agent never asks for them (decisions.md D1).
 * Managers customise per client; nothing here is fixed.
 */

import type { DataRoomTemplate } from "./types.ts";

export const defaultTemplate: DataRoomTemplate = {
  id: "sme-lending-default",
  version: "0.1.0-draft",
  name: { en: "SME lending file", ar: "ملف تمويل المنشآت" },
  description:
    "Standard structure for a Saudi SME approaching banks, guarantee programmes, or private lenders.",

  nodes: [
    {
      kind: "folder",
      title: { en: "Corporate", ar: "الوثائق النظامية" },
      children: [
        {
          kind: "item",
          title: { en: "Commercial registration", ar: "السجل التجاري" },
          description: {
            en: "Current CR. If it has expired, upload it anyway and tell us — renewal is usually the fastest unblock.",
            ar: "السجل التجاري الساري. إذا كان منتهياً، ارفعه وأخبرنا.",
          },
          required: true,
          documentType: "commercial_registration",
        },
        {
          kind: "item",
          title: { en: "Articles of association", ar: "عقد التأسيس" },
          description: {
            en: "Companies and partnerships only. Sole establishments can skip this.",
            ar: "للشركات فقط.",
          },
          required: false,
          documentType: "articles_of_association",
        },
        {
          kind: "item",
          title: { en: "Owner and partner identification", ar: "هوية الملاك والشركاء" },
          required: true,
        },
        {
          kind: "item",
          title: { en: "National address", ar: "العنوان الوطني" },
          required: true,
        },
      ],
    },

    {
      kind: "folder",
      title: { en: "Financial", ar: "المالية" },
      children: [
        {
          kind: "item",
          title: { en: "Bank statements — last 12 months", ar: "كشف حساب بنكي — آخر ١٢ شهر" },
          description: {
            en: "All business accounts. Official PDFs from the bank rather than screenshots.",
            ar: "جميع الحسابات التجارية، ملفات رسمية من البنك.",
          },
          required: true,
          documentType: "bank_statements",
        },
        {
          kind: "item",
          title: { en: "Financial statements", ar: "القوائم المالية" },
          description: {
            en: "Last two years if you have them. Audited, reviewed, or accountant-prepared — send what exists.",
            ar: "آخر سنتين إن وجدت.",
          },
          required: true,
          documentType: "financial_statements",
        },
        {
          kind: "item",
          title: { en: "Management accounts — current year", ar: "الحسابات الإدارية للسنة الحالية" },
          required: false,
          documentType: "management_accounts",
        },
        {
          kind: "item",
          title: { en: "Aged receivables", ar: "أعمار الذمم المدينة" },
          required: false,
          documentType: "aged_receivables",
        },
        {
          kind: "item",
          title: { en: "Aged payables", ar: "أعمار الذمم الدائنة" },
          required: false,
          documentType: "aged_payables",
        },
        {
          kind: "item",
          title: { en: "Existing debt schedule", ar: "جدول الالتزامات القائمة" },
          description: {
            en: "Every facility: lender, outstanding balance, monthly payment, maturity, what secures it.",
            ar: "لكل تسهيل: الجهة، الرصيد، القسط الشهري، تاريخ الاستحقاق، الضمان.",
          },
          required: true,
          documentType: "debt_schedule",
        },
      ],
    },

    {
      kind: "folder",
      title: { en: "Compliance", ar: "الالتزامات النظامية" },
      children: [
        {
          kind: "item",
          title: { en: "Zakat certificate", ar: "شهادة الزكاة" },
          required: true,
          documentType: "zakat_certificate",
        },
        {
          kind: "item",
          title: { en: "VAT certificate", ar: "شهادة ضريبة القيمة المضافة" },
          required: false,
          documentType: "vat_certificate",
        },
        {
          kind: "item",
          title: { en: "GOSI certificate", ar: "شهادة التأمينات الاجتماعية" },
          required: false,
          documentType: "gosi_certificate",
        },
        {
          kind: "item",
          title: { en: "Saudization certificate", ar: "شهادة السعودة" },
          required: false,
          documentType: "nitaqat_certificate",
        },
      ],
    },

    {
      kind: "folder",
      title: { en: "Commercial", ar: "التجارية" },
      children: [
        {
          kind: "item",
          title: { en: "Major customer contracts", ar: "عقود العملاء الرئيسيين" },
          description: {
            en: "Your largest customers by revenue. These matter most where revenue is concentrated.",
            ar: "أكبر العملاء من حيث الإيرادات.",
          },
          required: false,
          documentType: "customer_contract",
        },
        {
          kind: "item",
          title: { en: "Key supplier agreements", ar: "اتفاقيات الموردين" },
          required: false,
          documentType: "supplier_agreement",
        },
        {
          kind: "item",
          title: { en: "Sales report or POS export", ar: "تقرير المبيعات" },
          required: false,
          documentType: "sales_export",
        },
      ],
    },

    {
      kind: "folder",
      title: { en: "Operations", ar: "التشغيل" },
      children: [
        {
          kind: "item",
          title: { en: "Municipal licence", ar: "الرخصة البلدية" },
          required: false,
        },
        {
          kind: "item",
          title: { en: "Sector licences and certifications", ar: "التراخيص والشهادات القطاعية" },
          description: {
            en: "Whatever your line of work requires — contractor classification, health authority licence, and so on.",
            ar: "حسب نشاطك — تصنيف المقاولين، ترخيص صحي، وغيرها.",
          },
          required: false,
        },
        {
          kind: "item",
          title: { en: "Lease agreement", ar: "عقد الإيجار" },
          required: false,
          documentType: "lease_agreement",
        },
        {
          kind: "item",
          title: { en: "Insurance policies", ar: "وثائق التأمين" },
          required: false,
        },
      ],
    },

    {
      kind: "folder",
      title: { en: "Funding request", ar: "طلب التمويل" },
      children: [
        {
          kind: "item",
          title: { en: "Use of funds", ar: "أوجه استخدام التمويل" },
          description: {
            en: "What the money is for, broken down by amount.",
            ar: "تفصيل المبالغ وأوجه صرفها.",
          },
          required: true,
        },
        {
          kind: "item",
          title: { en: "Financial projections", ar: "التوقعات المالية" },
          required: false,
        },
        {
          kind: "item",
          title: { en: "Collateral documentation", ar: "وثائق الضمانات" },
          description: {
            en: "Title deeds, equipment invoices, or whatever evidences what you are offering as security.",
            ar: "صكوك، فواتير معدات، أو ما يثبت الضمان المعروض.",
          },
          required: false,
        },
      ],
    },
  ],
};
