// palette 3 · light 2 · arbitraryVar 0 · classNameTemplate 1
export default function Page({ active }: { active: boolean }) {
  return (
    <main className="bg-zinc-950/70 light:bg-white text-violet-400">
      <p className={`text-sm ${active ? "font-bold" : ""}`}>Hello</p>
      <span className="border-white/10 light:border-black/5 hover:border-fuchsia-500/50">.</span>
    </main>
  );
}
