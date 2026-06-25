// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('comments', table => {
    // The owner inbox pages open top-level threads ordered by (updated_at, id) via
    // keyset seek. Index that order so "load more" is a range scan, not a full sort
    // of the owned set.
    table.index(['status', 'updated_at', 'id'], 'comments_status_updated_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('comments', table => {
    table.dropIndex(['status', 'updated_at', 'id'], 'comments_status_updated_idx');
  });
};
