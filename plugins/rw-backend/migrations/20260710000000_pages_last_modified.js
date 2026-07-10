// @ts-check
/**
 * Add a per-page last-modified timestamp (epoch millis) to the pages registry,
 * for the global "Latest Changes" feed. Nullable: existing rows migrate to NULL
 * and are repopulated as each site's next scan re-swaps its pages. NULL and any
 * non-positive value both mean "unknown" and are excluded from the feed.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('pages', table => {
    table.bigInteger('last_modified').nullable();
    table.index(['last_modified'], 'pages_last_modified_idx');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('pages', table => {
    table.dropIndex(['last_modified'], 'pages_last_modified_idx');
    table.dropColumn('last_modified');
  });
};
