// Saved queries the "doctors" app contributes to its tenant's sendemail picker.
// Names are flat — first-loaded across all of a tenant's apps wins on collision.
module.exports = {
  doctor_invitations: {
    label: 'Doctors with no portal response yet',
    sql: `SELECT id, firstname, lastname, email, invitation_token, $1::text AS base_url
          FROM doctors.doctors
          WHERE last_response_at IS NULL AND deleted_at IS NULL
          ORDER BY lastname, firstname`,
    params: [{ name: 'base_url', label: 'Portal base URL', type: 'text' }],
  },
  doctor_followups: {
    label: 'Doctors past follow-up threshold (days)',
    sql: `SELECT id, firstname, lastname, email, invitation_token, $2::text AS base_url
          FROM doctors.doctors
          WHERE deleted_at IS NULL
            AND last_response_at IS NULL
            AND (last_follow_up_at IS NULL OR last_follow_up_at < NOW() - ($1::int || ' days')::interval)
          ORDER BY lastname, firstname`,
    params: [
      { name: 'days', label: 'Days since last follow-up', type: 'text' },
      { name: 'base_url', label: 'Portal base URL', type: 'text' },
    ],
  },
};
