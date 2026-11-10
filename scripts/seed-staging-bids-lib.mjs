// Made-up demo BID for the read-only BID viewer in Verdanote STAGING (step 6).
//
// The BID Builder worker writes a 17-section Brand Intelligence Document as markdown. This
// builds one made-up BID with the same 17 section headings for the demo client
// demo-glowdrip, clearly labelled as made up, so staff can check the viewer in staging. No
// real client BID is read or written here; loading real BIDs is an owner decision.
import { assertStagingUrl } from './seed-staging-dashboard-lib.mjs';

export { assertStagingUrl };

export const DEMO_BID_CLIENT = 'demo-glowdrip';

// Section titles in the BID Builder's order (repos/private/bid-builder/src/prompts/sections).
export const BID_SECTIONS = [
  'Company Analysis',
  'Offer & Funnel Context',
  'Target Customer Profile',
  'Jobs to Be Done',
  'Awareness Stage Mapping (Schwartz)',
  'Competitive Landscape',
  'Differentiation',
  'Claim Substantiation Inventory',
  'Customer Intelligence',
  'Past Ad Performance Review',
  'SWOT Analysis',
  'Reasons to Buy',
  'Hesitations to Buy & Objection Handling',
  'Reference Points (Deep Metaphor Analysis)',
  'Brand Voice Profile',
  'Content Themes',
  'Messaging Recommendations',
];

export function buildDemoBid() {
  const lines = [
    '# Glowdrip (demo) Brand Intelligence Document',
    '',
    '> Made-up staging BID. Every name, number and quote below is invented to check the viewer. It is not about a real brand.',
    '',
  ];
  BID_SECTIONS.forEach((title, i) => {
    lines.push(`## ${i + 1}. ${title}`, '');
    lines.push(`### Summary`, '');
    lines.push(`Made-up notes for ${title.toLowerCase()} of the Glowdrip demo brand, a fictional skincare line used only in staging.`, '');
    lines.push(`- Made-up point one for section ${i + 1}.`, `- Made-up point two for section ${i + 1}.`, '');
  });
  return {
    p_client_slug: DEMO_BID_CLIENT,
    p_title: 'Glowdrip (demo) BID',
    p_body_markdown: lines.join('\n'),
    p_source: 'staging-seed',
    p_source_ref: 'scripts/seed-staging-bids-lib.mjs',
    p_data_origin: 'made_up',
    p_generated_at: '2026-11-10T00:00:00Z',
  };
}
