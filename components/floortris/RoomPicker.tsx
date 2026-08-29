import { useEffect, useRef, useState } from 'react';

type RoomOption = { id: string; name: string };
type SampleOption = { id: string; label: string };

export default function RoomPicker({ currentId, currentName, savedRooms, samples, onOpenSaved, onOpenSample }: {
  currentId: string;
  currentName: string;
  savedRooms: RoomOption[];
  samples: SampleOption[];
  onOpenSaved: (id: string) => void;
  onOpenSample: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
  const openAndFocus = (last = false) => {
    setOpen(true);
    queueMicrotask(() => {
      const items = options();
      (last ? items.at(-1) : items[0])?.focus();
    });
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
    queueMicrotask(() => trigger.current?.focus());
  };
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = options(), current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== null && items.length) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'Tab') setOpen(false);
  };
  return <div className="ft-room-picker" ref={root}>
    <button ref={trigger} type="button" className="ft-room-picker-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls="ft-room-menu" aria-label={`Open rooms. Current room: ${currentName}`} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAndFocus(event.key === 'ArrowUp'); }
    }}>
      <span>Rooms</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div id="ft-room-menu" className="ft-room-menu" role="menu" aria-label="Open a saved room or sample" onKeyDown={onMenuKeyDown} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget !== trigger.current) setOpen(false);
    }}>
      <div className="ft-room-menu-group" role="group" aria-label="Your rooms">
        <span className="ft-room-menu-heading">Your rooms</span>
        {savedRooms.map(room => <button key={room.id} type="button" role="menuitemradio" aria-checked={room.id === currentId} onClick={() => choose(() => onOpenSaved(room.id))}>
          <span>{room.name}</span>{room.id === currentId && <span className="ft-room-menu-check" aria-hidden="true">✓</span>}
        </button>)}
      </div>
      <div className="ft-room-menu-group ft-room-menu-samples" role="group" aria-label="Sample rooms">
        <span className="ft-room-menu-heading">Sample rooms</span>
        {samples.map(sample => <button key={sample.id} type="button" role="menuitemradio" aria-checked={false} onClick={() => choose(() => onOpenSample(sample.id))}>
          <span>{sample.label}</span>
        </button>)}
      </div>
    </div>}
  </div>;
}
