// Who may open the growth dashboard (/admin/growth): the comma separated
// emails in GROWTH_VIEWER_EMAILS. Unset means nobody. Server side only; the
// frontend is told the answer through /user/self.
export const isGrowthViewer = (email?: string | null) => {
  if (!email) {
    return false;
  }
  const allowed = (process.env.GROWTH_VIEWER_EMAILS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
};
