// stack: localTableOrForm 2 — one table, one form of two fields; the search form (one field) is allowed
export function Forms() {
  return (
    <>
      <form role="search">
        <input type="hidden" name="page" value="1" />
        <Input name="q" />
        <button type="submit">Go</button>
      </form>
      <form>
        <input name="email" />
        <textarea name="message" />
      </form>
      <table>
        <thead><tr><th scope="col">A</th></tr></thead>
        <tbody />
      </table>
    </>
  );
}
declare function Input(props: { name: string }): null;
