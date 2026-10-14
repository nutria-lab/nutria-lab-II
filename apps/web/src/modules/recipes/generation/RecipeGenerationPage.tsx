import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner } from '../../../common/components/Banner';
import type { RecipeCategory } from '../../../services/recipeService';
import type { NutritionProfile } from '../../../services/nutritionProfileService';
import { nutritionProfileService } from '../../../services/nutritionProfileService';
import {
  RecipeGenerationError, createRecipeGenerationIdempotencyKey, recipeGenerationService, type RecipeDraft,
  type RecipeGenerationCountMode, type RecipeGenerationMode, type RecipeGenerationRequest,
  type RecipePreview, type ReusedRecipe,
} from '../../../services/recipeGenerationService';

const CATEGORIES: Array<{ value: RecipeCategory; label: string }> = [
  { value: 'VEGAN', label: 'Vegana' }, { value: 'VEGETARIAN', label: 'Vegetariana' },
  { value: 'HIGH_PROTEIN', label: 'Alta en proteína' }, { value: 'GLUTEN_FREE', label: 'Sin gluten' },
  { value: 'DAIRY_FREE', label: 'Sin lácteos' }, { value: 'LOW_CARB', label: 'Baja en carbohidratos' },
  { value: 'OTHER', label: 'Otra' },
];
const DIETS: Record<string, string> = { VEGAN: 'Vegana', VEGETARIAN: 'Vegetariana', PALEO: 'Paleo', KETO: 'Keto', PESCATARIAN: 'Pescetariana', ALL: 'Sin dieta específica' };
const RESTRICTIONS: Record<string, string> = { NUTS: 'Frutos secos', GLUTEN: 'Gluten', DAIRY: 'Lácteos', SHELLFISH: 'Mariscos', SOY: 'Soja' };
const GOALS: Record<string, string> = { LOSE_WEIGHT: 'Bajar de peso', GAIN_MUSCLE: 'Ganar músculo', MAINTAIN: 'Mantenerme' };
const TIMES: Record<string, string> = { QUICK: 'Rápido', STANDARD: 'Estándar', GOURMET: 'Sin apuro' };

type FormState = { mode: RecipeGenerationMode; countMode: RecipeGenerationCountMode; count: number; description: string; topic: string; categories: RecipeCategory[]; properties: string; maxPrepMinutes: string };
type Errors = Partial<Record<'description' | 'topic' | 'count' | 'profile', string>>;
type Phase = 'idle' | 'generating' | 'preview' | 'confirming' | 'confirmed' | 'error' | 'expired';
const INITIAL: FormState = { mode: 'BATCH', countMode: 'TOTAL_DESIRED', count: 3, description: '', topic: '', categories: [], properties: '', maxPrepMinutes: '' };

function properties(value: string) { return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean))); }
function validate(form: FormState, profile: NutritionProfile | null): Errors {
  const errors: Errors = {};
  if (!profile) errors.profile = 'Necesitamos cargar tu perfil antes de generar recetas.';
  if (form.mode === 'SINGLE') {
    const length = form.description.trim().length;
    if (length < 10 || length > 1000) errors.description = 'Describí la receta con entre 10 y 1000 caracteres.';
  } else {
    const length = form.topic.trim().length;
    if (length < 3 || length > 200) errors.topic = 'Escribí un tópico de entre 3 y 200 caracteres.';
    if (!Number.isInteger(form.count) || form.count < 1 || form.count > 10) errors.count = 'Elegí una cantidad entre 1 y 10.';
  }
  const minutes = Number(form.maxPrepMinutes);
  if (form.maxPrepMinutes && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) errors.count = 'El tiempo máximo debe estar entre 1 y 1440 minutos.';
  return errors;
}
function payload(form: FormState): RecipeGenerationRequest {
  const tags = properties(form.properties);
  return {
    mode: form.mode, countMode: form.mode === 'SINGLE' ? 'NEW_ONLY' : form.countMode,
    count: form.mode === 'SINGLE' ? 1 : form.count,
    ...(form.mode === 'SINGLE' ? { description: form.description.trim() } : { topic: form.topic.trim() }),
    ...(form.categories.length ? { categories: form.categories } : {}),
    ...(tags.length ? { properties: tags } : {}),
    ...(form.maxPrepMinutes ? { maxPrepMinutes: Number(form.maxPrepMinutes) } : {}),
  };
}
function errorText(error: RecipeGenerationError) {
  if (error.status === 400) return 'Revisá los datos del pedido y volvé a intentar.';
  if (error.status === 422) return 'La propuesta no pudo validarse. Podés ajustar el pedido y generar otra.';
  if (error.status === 429) return 'La generación está momentáneamente limitada. Esperá un momento y reintentá.';
  if (error.status === 503) return 'El servicio de IA no está disponible ahora. Tu pedido quedó intacto.';
  if (error.status === 409) return error.isExpired ? 'Esta propuesta expiró. Generá una nueva para continuar.' : 'La propuesta cambió. Generá una nueva para continuar.';
  return 'No pudimos completar la operación. Reintentá sin perder tu pedido.';
}
function errorTitle(status: RecipeGenerationError['status']) {
  if (status === 400) return 'Revisá el pedido';
  if (status === 422) return 'La propuesta necesita otro intento';
  if (status === 429) return 'Demasiadas solicitudes';
  if (status === 503) return 'Servicio no disponible';
  return 'No pudimos generar recetas';
}

function ProfileContext({ profile }: { profile: NutritionProfile | null }) {
  if (!profile) return null;
  const exclusions = profile.excludedIngredients ?? [];
  return <aside className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4" aria-label="Contexto de tu perfil">
    <div className="flex items-start gap-3"><span className="material-symbols-outlined text-brand-green" aria-hidden="true">verified_user</span><div className="min-w-0">
      <h2 className="text-sm font-bold text-on-surface">Se aplicará tu perfil</h2>
      <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">Se usa como contexto y no se puede relajar desde este pedido.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-on-surface-variant">Objetivo</dt><dd className="font-semibold">{GOALS[profile.goal] ?? profile.goal}</dd></div>
        <div><dt className="text-on-surface-variant">Dieta</dt><dd className="font-semibold">{DIETS[profile.diet] ?? profile.diet}</dd></div>
        <div><dt className="text-on-surface-variant">Tiempo</dt><dd className="font-semibold">{TIMES[profile.cookTimePreference] ?? profile.cookTimePreference}</dd></div>
        <div><dt className="text-on-surface-variant">Exclusiones</dt><dd className="font-semibold">{exclusions.length ? exclusions.map(item => RESTRICTIONS[item] ?? item).join(', ') : 'Ninguna'}</dd></div>
      </dl>
    </div></div>
  </aside>;
}

function DraftImage({ image, title, showAttribution = true }: { image: RecipeDraft['image']; title: string; showAttribution?: boolean }) {
  const [failed, setFailed] = useState(false);
  const visible = Boolean(image?.imageUrl && image.alt && !failed);
  return <figure className="overflow-hidden rounded-xl bg-surface-container">
    <div className="relative aspect-[4/3]">{visible ? <img src={image!.imageUrl} alt={image!.alt} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-on-surface-variant" role="img" aria-label={'Imagen no disponible para ' + title}><span className="material-symbols-outlined text-3xl" aria-hidden="true">restaurant</span><span className="text-xs">Imagen ilustrativa no disponible</span></div>}</div>
    {visible && image && showAttribution && <figcaption className="px-3 py-2 text-[11px] text-on-surface-variant"><span className="font-semibold text-on-surface">Imagen ilustrativa.</span> Foto de <a className="underline hover:text-brand-green" href={image.photographerUrl} target="_blank" rel="noreferrer">{image.photographer}</a> en <a className="underline hover:text-brand-green" href={image.sourceUrl} target="_blank" rel="noreferrer">Unsplash</a></figcaption>}
  </figure>;
}
function DraftCard({ draft, selected, onToggle }: { draft: RecipeDraft; selected: boolean; onToggle: () => void }) {
  return <article role="checkbox" tabIndex={0} aria-checked={selected} aria-label={draft.recipe.title + ', ' + (selected ? 'seleccionada' : 'no seleccionada')} onClick={onToggle} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); } }} className={'cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-green ' + (selected ? 'border-brand-green ring-2 ring-brand-green/20' : 'border-outline-variant/30')}>
    <DraftImage image={draft.image} title={draft.recipe.title} /><div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-headline text-base font-bold">{draft.recipe.title}</h3><p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{draft.recipe.description}</p></div><span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ' + (selected ? 'border-brand-green bg-brand-green text-white' : 'border-outline-variant text-transparent')} aria-hidden="true">✓</span></div><div className="flex flex-wrap gap-2 text-[11px] font-semibold text-on-surface-variant"><span className="rounded-full bg-surface-container px-2.5 py-1">{draft.recipe.prepMinutes + draft.recipe.cookMinutes} min</span>{draft.recipe.categories?.slice(0, 2).map(category => <span key={category} className="rounded-full bg-surface-container px-2.5 py-1">{CATEGORIES.find(item => item.value === category)?.label ?? category}</span>)}</div>{draft.warnings.length > 0 && <div className="rounded-xl bg-tertiary-container/20 px-3 py-2 text-xs text-on-tertiary-container" role="note"><strong>Advertencia:</strong> {draft.warnings.map(item => item.message).join(' ')}</div>}</div>
  </article>;
}
function ReusedCard({ item }: { item: ReusedRecipe }) {
  const reasons = item.matchReasons?.map(reason => reason.replace(/^(category|property|topic|prep-minutes):/, '')).filter(Boolean) ?? [];
  return <article className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4"><div className="flex gap-3"><span className="material-symbols-outlined text-brand-green" aria-hidden="true">history</span><div><h3 className="font-headline text-base font-bold">{item.recipe?.title ?? 'Receta existente'}</h3><p className="mt-1 text-xs text-on-surface-variant">Reutilizada porque coincide con tu pedido y perfil.</p>{reasons.length > 0 && <p className="mt-2 text-xs text-on-surface-variant">Coincidencias: {reasons.join(', ')}</p>}</div></div></article>;
}
function Rejected({ items }: { items: RecipePreview['rejected'] }) {
  if (!items.length) return null;
  return <section className="rounded-2xl border border-red-200 bg-red-50 p-4" aria-labelledby="rejected-title"><h3 id="rejected-title" className="font-headline text-sm font-bold text-red-900">No se pudieron incluir algunas propuestas</h3>{items.map((item, index) => <p key={(item.candidateIndex ?? 'general') + '-' + index} className="mt-2 text-xs text-red-800"><strong>{item.candidateIndex == null ? 'Resultado general' : 'Propuesta ' + (item.candidateIndex + 1)}:</strong> {item.errors?.map(error => error.message).join(' ') || 'No pasó la revisión.'}</p>)}</section>;
}
function Summary({ preview }: { preview: RecipePreview }) {
  return <div className="grid grid-cols-3 gap-2" aria-live="polite" aria-label="Resumen de la propuesta">{[['Solicitadas', preview.summary.requested], ['Reutilizadas', preview.summary.reused], ['Nuevas', preview.summary.generated]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-surface-container-low p-3 text-center"><p className="text-xl font-bold">{value}</p><p className="text-[11px] text-on-surface-variant">{label}</p></div>)}</div>;
}

export function RecipeGenerationPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [profile, setProfile] = useState<NutritionProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<RecipeGenerationError | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [savedImages, setSavedImages] = useState<Array<RecipeDraft['image']>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const confirmKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    nutritionProfileService.getProfile().then(value => { if (active) setProfile(value); }).catch(() => { if (active) setProfileError('No pudimos cargar tu perfil.'); }).finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  const expired = Boolean(preview?.expiresAt && new Date(preview.expiresAt).getTime() <= Date.now());
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: undefined })); };
  const toggleCategory = (value: RecipeCategory) => setForm(current => ({ ...current, categories: current.categories.includes(value) ? current.categories.filter(item => item !== value) : [...current.categories, value] }));
  const cancel = () => { sequence.current += 1; abortRef.current?.abort(); abortRef.current = null; setPhase('idle'); setRequestError(null); };
  const generate = async () => {
    if (phase === 'generating' || phase === 'confirming') return;
    const nextErrors = validate(form, profile); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { const first = Object.keys(nextErrors).find(key => key !== 'profile'); document.getElementById(first ? 'recipe-' + first : 'recipe-generation-heading')?.focus(); return; }
    sequence.current += 1; const id = sequence.current; abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setPhase('generating'); setRequestError(null); setPreview(null); setSelectedIds([]); setSaved([]); setSavedImages([]); confirmKeyRef.current = null;
    try { const result = await recipeGenerationService.preview(payload(form), controller.signal); if (id !== sequence.current || controller.signal.aborted) return; setPreview(result); setPhase('preview'); }
    catch (caught) { if (id !== sequence.current || controller.signal.aborted) return; const next = caught instanceof RecipeGenerationError ? caught : new RecipeGenerationError('No pudimos generar la propuesta.', undefined); setRequestError(next); setPhase(next.isExpired ? 'expired' : 'error'); }
    finally { if (id === sequence.current) abortRef.current = null; }
  };
  const toggleDraft = (draftId: string) => { if (phase !== 'preview' || expired) return; setSelectedIds(current => current.includes(draftId) ? current.filter(id => id !== draftId) : [...current, draftId]); confirmKeyRef.current = null; };
  const confirm = async () => {
    if (!preview || phase === 'confirming' || !selectedIds.length || expired) { if (expired) setPhase('expired'); return; }
    const ids = selectedIds.filter(id => preview.drafts.some(draft => draft.draftId === id)); if (!ids.length) return;
    sequence.current += 1; const id = sequence.current; const controller = new AbortController(); abortRef.current = controller; setPhase('confirming'); setRequestError(null);
    const confirmationKey = confirmKeyRef.current ?? createRecipeGenerationIdempotencyKey(); confirmKeyRef.current = confirmationKey;
    try { const result = await recipeGenerationService.confirm(preview.generationRunId, ids, controller.signal, confirmationKey); if (id !== sequence.current || controller.signal.aborted) return; setSaved(result.items.map(item => item.id)); setSavedImages(result.items.map(item => item.image)); setPhase('confirmed'); }
    catch (caught) { if (id !== sequence.current || controller.signal.aborted) return; const next = caught instanceof RecipeGenerationError ? caught : new RecipeGenerationError('No pudimos guardar las recetas.', undefined); setRequestError(next); setPhase(next.isExpired ? 'expired' : 'preview'); }
    finally { if (id === sequence.current) abortRef.current = null; }
  };
  const selectedDrafts = useMemo(() => preview?.drafts.filter(draft => selectedIds.includes(draft.draftId)) ?? [], [preview, selectedIds]);

  if (profileLoading) return <main className="mx-auto max-w-6xl px-4 py-8 md:px-8" aria-busy="true" aria-live="polite"><div className="h-8 w-64 animate-pulse rounded bg-surface-container" /><div className="mt-6 h-48 animate-pulse rounded-2xl bg-surface-container" /></main>;
  if (phase === 'confirmed') return <main className="mx-auto max-w-4xl px-4 py-8 md:px-8"><section className="rounded-3xl border border-brand-green/20 bg-white p-8 text-center shadow-sm"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green text-white"><span className="material-symbols-outlined text-3xl" aria-hidden="true">check</span></div><h1 className="mt-5 font-headline text-2xl font-bold">Recetas guardadas</h1><p className="mt-2 text-sm text-on-surface-variant">Guardamos {saved.length} {saved.length === 1 ? 'receta' : 'recetas'} en tu catálogo.</p><div className="mx-auto mt-5 max-w-lg space-y-2 text-left">{selectedDrafts.map((draft, index) => <div key={draft.draftId} className="flex items-center gap-3 rounded-xl bg-surface-container-low px-3 py-3 text-sm"><div className="h-20 w-24 shrink-0"><DraftImage image={savedImages[index] ?? draft.image} title={draft.recipe.title} showAttribution={false} /></div><div className="flex min-w-0 flex-1 justify-between gap-3"><span className="font-semibold">{draft.recipe.title}</span><span className="shrink-0 text-xs text-on-surface-variant">Guardada</span></div></div>)}</div><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><button type="button" onClick={() => navigate('/recipes')} className="min-h-11 rounded-xl bg-brand-green px-6 py-3 text-sm font-bold text-white hover:bg-brand-green-dark">Ver catálogo</button><button type="button" onClick={() => { setPhase('idle'); setPreview(null); setSelectedIds([]); setSaved([]); setSavedImages([]); confirmKeyRef.current = null; }} className="min-h-11 rounded-xl border border-outline-variant/50 px-6 py-3 text-sm font-bold">Generar otra propuesta</button></div></section></main>;

  return <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
    <div className="mb-6"><button type="button" onClick={() => navigate('/recipes')} className="mb-4 text-sm font-semibold text-brand-green hover:underline">← Recetario</button><h1 id="recipe-generation-heading" tabIndex={-1} className="font-headline text-3xl font-bold md:text-4xl">Proponeme recetas</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">Pedí una receta concreta o varias ideas por tópico. Revisá la propuesta y elegí qué guardar.</p></div>
    {profileError && <div className="mb-5"><Banner variant="error" message={profileError} /></div>}
    {requestError && phase === 'error' && <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4" role="alert"><h2 className="font-headline font-bold text-red-900">{errorTitle(requestError.status)}</h2><p className="mt-1 text-sm text-red-800">{errorText(requestError)}</p><button type="button" onClick={() => void generate()} className="mt-3 min-h-10 rounded-xl bg-red-800 px-4 py-2 text-sm font-bold text-white">Reintentar</button></section>}
    {phase === 'expired' && <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alert"><h2 className="font-headline font-bold text-on-tertiary-container">La propuesta expiró</h2><p className="mt-1 text-sm text-on-tertiary-container">Generá una nueva; no confirmamos en silencio.</p><button type="button" onClick={() => void generate()} className="mt-3 min-h-10 rounded-xl bg-brand-green px-4 py-2 text-sm font-bold text-white">Volver a generar</button></section>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.65fr)]">
      <section className="space-y-5" aria-labelledby="request-title"><div className="rounded-2xl border border-outline-variant/30 bg-white p-5 shadow-sm md:p-6"><h2 id="request-title" className="font-headline text-lg font-bold">¿Qué querés cocinar?</h2><p className="mt-1 text-xs text-on-surface-variant">La IA propone; vos decidís qué se guarda.</p>
        <div className="mt-5 grid grid-cols-2 rounded-xl bg-surface-container p-1" role="tablist" aria-label="Tipo de pedido">{(['SINGLE', 'BATCH'] as const).map(mode => <button key={mode} type="button" role="tab" aria-selected={form.mode === mode} onClick={() => { update('mode', mode); setPreview(null); setPhase('idle'); }} className={'min-h-11 rounded-lg text-sm font-bold ' + (form.mode === mode ? 'bg-white text-brand-green shadow-sm' : 'text-on-surface-variant')}>{mode === 'SINGLE' ? 'Una receta' : 'Varias recetas'}</button>)}</div>
        <div className="mt-5 space-y-4">{form.mode === 'SINGLE' ? <div><label htmlFor="recipe-description" className="text-sm font-bold">Describí la receta</label><textarea id="recipe-description" value={form.description} onChange={event => update('description', event.target.value)} aria-describedby="recipe-description-help recipe-description-error" aria-invalid={Boolean(errors.description)} rows={6} maxLength={1000} placeholder="Ej. Una cena rápida con pollo, verduras y arroz integral..." className="mt-2 w-full resize-y rounded-xl border border-outline-variant/50 bg-brand-cream px-4 py-3 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20" /><div id="recipe-description-help" className="mt-1 flex justify-between text-xs text-on-surface-variant"><span>Entre 10 y 1000 caracteres.</span><span>{form.description.length}/1000</span></div>{errors.description && <p id="recipe-description-error" className="mt-1 text-xs font-semibold text-error" role="alert">{errors.description}</p>}</div> : <><div><label htmlFor="recipe-topic" className="text-sm font-bold">Tópico</label><input id="recipe-topic" value={form.topic} onChange={event => update('topic', event.target.value)} aria-describedby="recipe-topic-help recipe-topic-error" aria-invalid={Boolean(errors.topic)} maxLength={200} placeholder="Ej. cenas vegetarianas rápidas" className="mt-2 w-full rounded-xl border border-outline-variant/50 bg-brand-cream px-4 py-3 text-sm" /><p id="recipe-topic-help" className="mt-1 text-xs text-on-surface-variant">Entre 3 y 200 caracteres.</p>{errors.topic && <p id="recipe-topic-error" className="mt-1 text-xs font-semibold text-error" role="alert">{errors.topic}</p>}</div><div><label htmlFor="recipe-count" className="text-sm font-bold">Cantidad</label><input id="recipe-count" type="number" min={1} max={10} value={form.count} onChange={event => update('count', Number(event.target.value))} aria-describedby="recipe-count-help recipe-count-error" aria-invalid={Boolean(errors.count)} className="mt-2 w-full rounded-xl border border-outline-variant/50 bg-brand-cream px-4 py-3 text-sm" /><p id="recipe-count-help" className="mt-1 text-xs text-on-surface-variant">Elegí entre 1 y 10.</p>{errors.count && <p id="recipe-count-error" className="mt-1 text-xs font-semibold text-error" role="alert">{errors.count}</p>}</div><fieldset><legend className="text-sm font-bold">¿Cómo contar la cantidad?</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="rounded-xl border border-outline-variant/40 p-3 text-sm"><input type="radio" name="count-mode" checked={form.countMode === 'TOTAL_DESIRED'} onChange={() => update('countMode', 'TOTAL_DESIRED')} className="mr-2 accent-brand-green" />Quiero {form.count} en total</label><label className="rounded-xl border border-outline-variant/40 p-3 text-sm"><input type="radio" name="count-mode" checked={form.countMode === 'NEW_ONLY'} onChange={() => update('countMode', 'NEW_ONLY')} className="mr-2 accent-brand-green" />Quiero {form.count} nuevas</label></div></fieldset></>}
          <fieldset><legend className="text-sm font-bold">Filtros opcionales</legend><div className="mt-3 flex flex-wrap gap-2">{CATEGORIES.map(category => <button key={category.value} type="button" aria-pressed={form.categories.includes(category.value)} onClick={() => toggleCategory(category.value)} className={'rounded-full border px-3 py-2 text-xs font-semibold ' + (form.categories.includes(category.value) ? 'border-brand-green bg-brand-green text-white' : 'border-outline-variant/50 bg-white text-on-surface-variant')}>{category.label}</button>)}</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><label htmlFor="recipe-properties" className="text-xs font-semibold text-on-surface-variant">Propiedades, separadas por coma</label><input id="recipe-properties" value={form.properties} onChange={event => update('properties', event.target.value)} placeholder="Alto en fibra, rápido" className="mt-1 w-full rounded-xl border border-outline-variant/50 bg-brand-cream px-3 py-2.5 text-sm" /></div><div><label htmlFor="recipe-max-time" className="text-xs font-semibold text-on-surface-variant">Tiempo máximo (minutos)</label><input id="recipe-max-time" inputMode="numeric" value={form.maxPrepMinutes} onChange={event => update('maxPrepMinutes', event.target.value)} placeholder="Opcional" className="mt-1 w-full rounded-xl border border-outline-variant/50 bg-brand-cream px-3 py-2.5 text-sm" /></div></div></fieldset>
          {errors.profile && <p className="text-sm font-semibold text-error" role="alert">{errors.profile}</p>}<div className="flex flex-col-reverse gap-3 border-t border-outline-variant/20 pt-5 sm:flex-row sm:justify-end">{phase === 'generating' ? <button type="button" onClick={cancel} className="min-h-11 rounded-xl border border-outline-variant/50 px-5 py-3 text-sm font-bold">Cancelar generación</button> : <button type="button" onClick={() => navigate('/recipes')} className="min-h-11 rounded-xl border border-outline-variant/50 px-5 py-3 text-sm font-bold">Volver</button>}<button type="button" onClick={() => void generate()} disabled={phase === 'generating' || phase === 'confirming'} className="min-h-11 rounded-xl bg-brand-green px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{phase === 'generating' ? 'Generando propuesta…' : 'Generar propuesta'}</button></div>{phase === 'generating' && <p className="text-xs text-on-surface-variant" role="status" aria-live="polite">La IA está preparando una propuesta. Podés cancelar sin perder el pedido.</p>}</div></div><ProfileContext profile={profile} /></section>
      <section className="space-y-4" aria-labelledby="preview-title"><div><h2 id="preview-title" className="font-headline text-xl font-bold">Tu propuesta</h2><p className="mt-1 text-xs text-on-surface-variant">Nada se guarda hasta que lo confirmes.</p></div>{phase === 'generating' && <div className="space-y-3" aria-busy="true" aria-live="polite"><div className="h-24 animate-pulse rounded-2xl bg-surface-container" /><div className="h-56 animate-pulse rounded-2xl bg-surface-container" /><p className="text-center text-xs text-on-surface-variant">Generando y revisando resultados…</p></div>}{phase !== 'generating' && !preview && !requestError && phase !== 'expired' && <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-surface-container-low p-8 text-center"><span className="material-symbols-outlined text-4xl text-brand-green" aria-hidden="true">auto_awesome</span><p className="mt-3 font-headline font-bold">Todavía no hay una propuesta</p><p className="mt-1 text-sm text-on-surface-variant">Completá el pedido y revisá las recetas antes de guardarlas.</p></div>}{preview && (phase === 'preview' || phase === 'expired' || phase === 'confirming') && <><Summary preview={preview} />{expired && <div className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-on-tertiary-container" role="alert">Esta propuesta expiró y ya no puede confirmarse.</div>}{preview.reused.length > 0 && <section className="space-y-2" aria-labelledby="reused-title"><h3 id="reused-title" className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Recetas existentes reutilizadas</h3>{preview.reused.map((item, index) => <ReusedCard key={(item.recipe.id ?? 'reused') + '-' + index} item={item} />)}</section>}{preview.drafts.length > 0 && <section className="space-y-2" aria-labelledby="drafts-title"><div className="flex justify-between"><h3 id="drafts-title" className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Nuevas recetas para revisar</h3><span className="text-xs text-on-surface-variant">{selectedIds.length} seleccionadas</span></div><div className="space-y-3">{preview.drafts.map(draft => <DraftCard key={draft.draftId} draft={draft} selected={selectedIds.includes(draft.draftId)} onToggle={() => toggleDraft(draft.draftId)} />)}</div></section>}{preview.drafts.length === 0 && <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5 text-center"><p className="font-headline font-bold">No hay borradores nuevos</p><p className="mt-1 text-sm text-on-surface-variant">No se guardará nada nuevo.</p></div>}<Rejected items={preview.rejected} /><div className="sticky bottom-2 rounded-2xl border border-outline-variant/30 bg-white/95 p-3 shadow-lg"><button type="button" onClick={() => void confirm()} disabled={!selectedIds.length || expired || phase !== 'preview'} className="min-h-11 w-full rounded-xl bg-brand-green px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{phase === 'confirming' ? 'Guardando…' : 'Confirmar y guardar ' + (selectedIds.length ? '(' + selectedIds.length + ')' : '')}</button><p className="mt-2 text-center text-[11px] text-on-surface-variant">Seleccioná al menos un borrador nuevo para confirmar.</p></div></>}</section>
    </div>
  </main>;
}
