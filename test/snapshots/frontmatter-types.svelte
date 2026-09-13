<script module>
export const metadata = {title:"Types: all of them",published:"2026-09-12",draft:false,weight:3.5,tags:["a","b","c"],nested:{deep:[1,"two"]},empty:null,nothing:null,quoted:"a {brace} in yaml"};
const { title, published, draft, weight, tags, nested, empty, nothing, quoted } = metadata;
</script>
<p>{title} · {weight} · {tags.length} · {nested.deep[1]}</p>