/** Phase 2 placeholder for an area whose screens arrive in a later phase. */
export default function AreaPlaceholder(props: {
  title: string;
  intro: string;
  phase: string;
  coming: string[];
}) {
  return (
    <section className="stack">
      <h1>{props.title}</h1>
      <p>{props.intro}</p>
      <div className="surface empty-panel">
        <p className="field-label">Coming in {props.phase}</p>
        <ul>
          {props.coming.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
