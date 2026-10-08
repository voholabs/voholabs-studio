// The growth dashboard (/admin/growth) is for this one account only, not for
// every superadmin. Shared by the API, which enforces it, and the frontend,
// which only uses it to decide whether to show the link.
export const GROWTH_VIEWER_EMAIL = 'hello@voholabs.com';

export const isGrowthViewer = (email?: string | null) =>
  !!email && email.trim().toLowerCase() === GROWTH_VIEWER_EMAIL;
