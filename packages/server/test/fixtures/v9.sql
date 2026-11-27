-- Unpopulated schema from sqlite_schema of a library created by 1bde740.
CREATE TABLE persona (id text primary key, name text not null, json text not null);
CREATE TABLE hat (id text primary key, name text not null, json text not null);
CREATE TABLE pack (id text primary key, name text not null, json text not null);
CREATE TABLE local (card text primary key, json text not null);
CREATE TABLE secret (id text primary key, name text not null, json text not null);
CREATE TABLE provider (id text primary key, name text not null, json text not null);
CREATE TABLE routing (id integer primary key check (id = 1), json text not null);
CREATE TABLE names (id integer primary key check (id = 1), etag text, json text not null);
CREATE TABLE card (id text primary key, title text not null, json text not null, updated integer not null, summary text, facets text, origin text);
CREATE TABLE story (id integer primary key autoincrement, card text not null, title text, head integer, next integer not null default 0, updated integer not null, starred integer not null default 0, persona text, yields integer not null default 0);
CREATE TABLE node (story integer not null references story (id) on delete cascade, id integer not null,
  parent integer, json text not null, primary key (story, id));
CREATE TABLE call (seq integer primary key autoincrement, story integer not null, node integer not null,
  json text not null, foreign key (story, node) references node (story, id) on delete cascade);
CREATE INDEX call_node on call (story, node);
CREATE TABLE decision (id integer primary key check (id = 1), json text not null);
CREATE TABLE persona_default (id integer primary key check (id = 1), persona text not null);
CREATE TABLE depot (id text primary key, name text not null, json text not null);
CREATE TABLE network (id integer primary key check (id = 1), json text not null);
CREATE TABLE pack_default (id integer primary key check (id = 1), pack text not null);
pragma user_version=9;
