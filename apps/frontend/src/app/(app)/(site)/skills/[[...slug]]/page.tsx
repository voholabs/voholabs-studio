import { redirect } from 'next/navigation';

// Skills were replaced by Flows. Anyone who bookmarked the skills library, or
// followed a link to one skill, lands on the flows page instead of a 404.
export default async function Index() {
  redirect('/flows');
}
