// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('comments', table => {
    table.uuid('id').primary(); // uuid v7
    table.uuid('parent_id').nullable();
    table.text('site_ref').notNullable();
    table.text('page_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('author_ref').notNullable();
    table.text('author_profile').nullable(); // JSON {displayName, picture?}
    table.text('body').notNullable();
    table.text('body_html').notNullable();
    table.text('selectors').notNullable(); // JSON Selector[]
    table.text('status').notNullable(); // 'open' | 'resolved'
    table.dateTime('created_at').notNullable();
    table.dateTime('updated_at').notNullable();
    table.dateTime('resolved_at').nullable();
    table.text('resolved_by').nullable();
    table.dateTime('deleted_at').nullable();
    table.index(['site_ref', 'page_ref'], 'comments_site_page_idx');
    table.index(['site_ref', 'page_ref', 'status'], 'comments_site_page_status_idx');
    table.index(['parent_id'], 'comments_parent_idx');
    table.index(['section_ref'], 'comments_section_idx');
    // The owner inbox lists open top-level threads paged by (updated_at, id) via
    // keyset seek. status leads (equality-filtered to 'open') so the trailing
    // (updated_at, id) supports a range scan for "load more", not a full sort of
    // the owned set.
    table.index(['status', 'updated_at', 'id'], 'comments_status_updated_idx');
  });

  await knex.schema.createTable('section_ownership', table => {
    table.text('site_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('entity_ref').notNullable();
    table.text('entity_owner_ref').nullable();
    table.primary(['site_ref', 'section_ref']);
    table.index(['entity_owner_ref'], 'section_ownership_owner_idx');
  });

  // The `sections` table is dense (one row per section) and carries both structure
  // (parent_section_ref) and the effective-ownership rollup (entity_ref, entity_owner_ref, and an
  // owner-relative section_path). The owner index serves the inbox's hot "sections owned by X" query.
  await knex.schema.createTable('sections', table => {
    table.text('site_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('section_path').notNullable();
    table.text('parent_section_ref').nullable();
    table.text('entity_ref').notNullable();
    table.text('entity_owner_ref').nullable();
    table.primary(['site_ref', 'section_ref']);
    table.index(['entity_owner_ref'], 'sections_owner_idx');
  });

  await knex.schema.createTable('pages', table => {
    table.text('site_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('subpath').notNullable();
    table.text('title').notNullable();
    table.primary(['site_ref', 'section_ref', 'subpath']);
  });

  await knex.schema.createTable('site_refresh', table => {
    table.text('site_ref').primary();
    table.dateTime('next_update_at').notNullable();
    table.dateTime('last_built_at').nullable();
    table.text('result_hash').nullable();
    table.text('errors').nullable();
    table.dateTime('last_discovery_at').notNullable();
    table.index(['next_update_at'], 'site_refresh_next_update_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('site_refresh');
  await knex.schema.dropTableIfExists('pages');
  await knex.schema.dropTableIfExists('sections');
  await knex.schema.dropTableIfExists('section_ownership');
  await knex.schema.dropTableIfExists('comments');
};
