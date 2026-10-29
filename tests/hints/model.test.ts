import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acceptEdit, computeHints} from '../../src/hints/model.js';
import {buildCatalog} from '../../src/hints/catalog.js';
import {catalog} from './fixture.js';

const labels = (line: string) => computeHints(catalog, line).items.map(i => i.label);

test('blank lines have no stage', () => {
	assert.equal(computeHints(catalog, '').stage, 'none');
	assert.equal(computeHints(catalog, '   ').stage, 'none');
});

test('first token matches commands', () => {
	const h = computeHints(catalog, 'e');
	assert.equal(h.stage, 'command');
	assert.equal(h.tokenStart, 0);
	assert.equal(h.token, 'e');
	assert.deepEqual(h.items.map(i => i.label).slice(0, 2), ['echo', 'exit']);
	assert.ok(h.items[0]!.prefix);
});

test('leading whitespace shifts tokenStart', () => {
	const h = computeHints(catalog, '  ex');
	assert.equal(h.tokenStart, 2);
	assert.equal(h.items[0]!.label, 'exit');
});

test('exact command is still listed', () => {
	assert.equal(computeHints(catalog, 'echo').items[0]!.label, 'echo');
});

test('unknown command is flagged', () => {
	const h = computeHints(catalog, 'zzzz');
	assert.equal(h.stage, 'command');
	assert.equal(h.unknown, true);
	assert.deepEqual(h.items, []);
});

test('unknown first token followed by a space has no stage', () => {
	assert.equal(computeHints(catalog, 'zzzz ').stage, 'none');
	assert.equal(computeHints(catalog, 'zzzz foo').stage, 'none');
});

test('subcommand stage after a command and a space', () => {
	const h = computeHints(catalog, 'mod ');
	assert.equal(h.stage, 'sub');
	assert.equal(h.token, '');
	assert.equal(h.tokenStart, 4);
	assert.deepEqual(labels('mod '), ['install', 'update', 'remove', 'list', 'help']);
	assert.equal(h.items[0]!.prefix, false);
	assert.ok(h.usage);
});

test('trailing spaces do not change the stage', () => {
	assert.equal(computeHints(catalog, 'mod   ').stage, 'sub');
	assert.equal(computeHints(catalog, 'mod   ').tokenStart, 6);
});

test('partial subcommand and alias matches', () => {
	const h = computeHints(catalog, 'mod i');
	assert.equal(h.stage, 'sub');
	assert.equal(h.items[0]!.label, 'i');
	assert.equal(h.items[0]!.via, 'install');
	assert.equal(computeHints(catalog, 'mod ins').items[0]!.label, 'install');
	assert.equal(computeHints(catalog, 'mod ins').items[0]!.via, undefined);
});

test('argument stage after a leaf subcommand', () => {
	const h = computeHints(catalog, 'mod install ');
	assert.equal(h.stage, 'arg');
	assert.deepEqual(h.items, []);
	assert.equal(h.usage!.head, 'mod install');
	assert.deepEqual(h.usage!.tokens.map(t => t.text), ['[source]…']);
	assert.equal(h.usage!.active, 0);
});

test('alias resolves in the path', () => {
	const h = computeHints(catalog, 'mod rm ');
	assert.equal(h.stage, 'arg');
	assert.equal(h.usage!.active, 0);
});

test('nested subcommands', () => {
	const h = computeHints(catalog, 'claude auth ');
	assert.equal(h.stage, 'sub');
	assert.deepEqual(h.items.map(i => i.label), ['login', 'logout', 'help']);
});

test('unmatched partial subcommand falls back to the argument stage', () => {
	const h = computeHints(catalog, 'mod zzz');
	assert.equal(h.stage, 'arg');
	assert.deepEqual(h.items, []);
});

test('command without subs is in the argument stage', () => {
	const h = computeHints(catalog, 'echo hi');
	assert.equal(h.stage, 'arg');
	assert.equal(h.usage!.head, 'echo');
});

test('command stage items carry their own usage', () => {
	const h = computeHints(catalog, 'ec');
	assert.equal(h.items[0]!.usage!.head, 'echo');
	assert.equal(h.usage, undefined);
});

test('ranges are reported for fuzzy matches', () => {
	const h = computeHints(catalog, 'xt');
	assert.equal(h.items[0]!.label, 'exit');
	assert.equal(h.items[0]!.prefix, false);
	assert.ok(h.items[0]!.ranges.length > 0);
});

test('malformed input never throws', () => {
	for (const bad of [undefined, null, 5, {}] as unknown[]) {
		assert.equal(computeHints(catalog, bad as string).stage, 'none');
	}
	assert.doesNotThrow(() => computeHints(catalog, 'a '.repeat(5000)));
	assert.doesNotThrow(() => computeHints(undefined as never, 'x'));
});

test('acceptEdit replaces only the token and appends one space', () => {
	const h = computeHints(catalog, 'mod ins');
	assert.deepEqual(acceptEdit('mod ins', h, h.items[0]!), {value: 'mod install ', cursor: 12});
	const c = computeHints(catalog, 'ex');
	assert.deepEqual(acceptEdit('ex', c, c.items[0]!), {value: 'exit ', cursor: 5});
});

test('acceptEdit does not add a second space', () => {
	const h = computeHints(catalog, 'mod ins');
	assert.deepEqual(acceptEdit('mod ins tail', h, h.items[0]!), {value: 'mod install tail', cursor: 12});
});

test('acceptEdit with an empty token inserts at the end', () => {
	const h = computeHints(catalog, 'mod ');
	assert.deepEqual(acceptEdit('mod ', h, h.items[0]!), {value: 'mod install ', cursor: 12});
});

test('acceptEdit clamps a bogus token start', () => {
	const h = {...computeHints(catalog, 'ex'), tokenStart: 99};
	assert.doesNotThrow(() => acceptEdit('ex', h, h.items[0]!));
});

test('commands without usage metadata have no usage line', () => {
	assert.equal(computeHints(catalog, 'help ').usage, undefined);
	assert.equal(computeHints(catalog, 'claude ').usage, undefined);
	assert.equal(computeHints(catalog, 'cle').items[0]!.usage, undefined);
});

test('usage-only results carry a usage and no items', () => {
	for (const line of ['claude ask ', 'claude auth login ', 'mod remove x']) {
		const h = computeHints(catalog, line);
		assert.equal(h.items.length, 0, line);
		assert.ok(h.usage, line);
	}
});

test('subcommand items carry their own usage', () => {
	const h = computeHints(catalog, 'doc ');
	const ask = h.items.find(i => i.label === 'ask')!;
	assert.equal(ask.usage?.head, 'doc ask');
	assert.deepEqual(ask.usage?.tokens.map(t => t.text), ['[--new]', '[--model <m>]', '<text…>']);
	assert.equal(h.items.find(i => i.label === 'help')?.usage?.head, 'doc help');
});

test('the argument under the cursor carries its doc', () => {
	const h = computeHints(catalog, 'doc ask ');
	assert.equal(h.stage, 'arg');
	assert.equal(h.usage!.tokens[h.usage!.active]?.text, '<text…>');
	assert.deepEqual(h.usage!.doc, {label: '<text>…', description: 'What to ask'});
	assert.deepEqual(computeHints(catalog, 'doc auth login ').usage!.doc, {label: '[account]', description: 'Account name'});
	assert.equal(computeHints(catalog, 'mod install ').usage!.doc, undefined);
});

test('an option value is skipped and its option documented while typed', () => {
	const typing = computeHints(catalog, 'doc ask --model ');
	assert.equal(typing.usage!.active, -1);
	assert.deepEqual(typing.usage!.doc, {label: '--model <m>, -m', description: 'Model to use'});
	assert.deepEqual(typing.items, []);
	assert.deepEqual(computeHints(catalog, 'doc ask -m opu').usage!.doc, {label: '--model <m>, -m', description: 'Model to use'});
	const after = computeHints(catalog, 'doc ask --model opus ');
	assert.equal(after.usage!.tokens[after.usage!.active]?.text, '<text…>');
});

test('a dash at the argument stage lists the option names, not values', () => {
	assert.deepEqual(labels('doc ask -'), ['--new', '--model']);
	assert.deepEqual(labels('doc ask -m'), ['-m']);
	const h = computeHints(catalog, 'doc ask --m');
	assert.equal(h.stage, 'arg');
	assert.equal(h.items[0]!.label, '--model');
	assert.equal(h.items[0]!.description, 'Model to use');
	assert.equal(h.usage!.doc, undefined);
	assert.deepEqual(labels('doc ask hello --'), ['--new', '--model']);
	assert.deepEqual(labels('mod install -'), []);
	assert.deepEqual(acceptEdit('doc ask --m', h, h.items[0]!), {value: 'doc ask --model ', cursor: 16});
});

test('a pattern option (--<field>) claims a concrete option and skips its value', () => {
	const own = buildCatalog([
		{
			name: 'acct',
			description: 'Accounts',
			usage: 'acct <name> [--<field> <value>]…',
			args: [{name: 'name', description: 'Account name'}],
			options: [{name: '--<field>', value: '<value>', description: 'A field of the kind', repeatable: true}],
			run() {},
		},
	]);
	const typing = computeHints(own, 'acct --login ');
	assert.deepEqual(typing.usage!.doc, {label: '--<field> <value> …', description: 'A field of the kind'});
	const after = computeHints(own, 'acct --login bob ');
	assert.equal(after.usage!.tokens[after.usage!.active]?.text, '<name>');
});
