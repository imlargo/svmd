Use the {#if} block when you need a branch, and close it with {/if} at the end.

Paste { "name": "foo", "n": 1 } into your config.

Pick {a, b} from the list, and leave an unclosed { brace alone.

Empty {} braces and a lone } too.

Real ones still work: {price} and {items.length} and {fmt(date)}.

Escape hatch for an object: {({ a: 1 })}
