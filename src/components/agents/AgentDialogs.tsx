import { useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { AgentRole, AutonomyLevel, Department, InternSpecialty, RoomLocation } from '@/types';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Dialog';
import { ModelSelect } from '@/components/ui/helpers';
import { BUILTIN_SPECIALTIES } from '@/engine/internshipSystem';
import { mentorCandidates, suggestMentor } from '@/engine/team';

const CUSTOM = '__custom__';

const ROLE_DEFAULTS: Record<AgentRole, { department: Department; room: RoomLocation }> = {
  manager: { department: 'Executive', room: 'Executive Suite' },
  architect: { department: 'Architecture', room: 'Architecture Lab' },
  frontend: { department: 'Engineering', room: 'Dev Bay' },
  backend: { department: 'Engineering', room: 'Dev Bay' },
  qa: { department: 'Quality & Security', room: 'QA Vault' },
  intern: { department: 'Incubator', room: 'Incubator Pod' },
};

export function AddAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useAgentStore((s) => s.addCustomAgent);
  const select = useAgentStore((s) => s.selectAgent);
  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>('backend');
  const [specialty, setSpecialty] = useState('');
  const [focus, setFocus] = useState('');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState('');
  const [autonomy, setAutonomy] = useState<AutonomyLevel>('Semi-Autonomous');
  const [prompt, setPrompt] = useState('');

  const submit = () => {
    const d = ROLE_DEFAULTS[role];
    const id = add({ name: name.trim(), role, specialty, focus, title: title.trim() || specialty.trim() || role, department: d.department, roomLocation: d.room, model: model || 'auto', autonomyLevel: autonomy, systemPrompt: prompt.trim() || undefined });
    select(id);
    setName('');
    setTitle('');
    setPrompt('');
    setSpecialty('');
    setFocus('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add agent" description="Custom agents can be assigned tasks in a plan." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={submit}>Add agent</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role / specialty" hint="Any domain. You are not limited to software roles.">
            <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="e.g. IoT & Embedded Engineer" />
          </Field>
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data engineer" /></Field>
        </div>
        <Field label="Domain instructions" hint="Sovereign uses this to assign tasks. These instructions also go to the agent on every task.">
          <Textarea value={focus} onChange={(e) => setFocus(e.target.value)} rows={3} placeholder="Study STM32 firmware, C/C++, MQTT, sensors and OTA updates. Read the project documentation and verify changes with the available toolchain." />
        </Field>
        <Field label="Workflow" hint="Controls routing, default model and office placement. Your specialty can be anything.">
          <Select value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
            {(Object.keys(ROLE_DEFAULTS) as AgentRole[]).map((r) => <option key={r} value={r}>{r === 'backend' ? 'Engineering / implementation' : r === 'architect' ? 'Architecture / research' : r === 'qa' ? 'Review / testing' : r === 'intern' ? 'Junior workflow' : r}</option>)}
          </Select>
        </Field>
        <Field label="Model" hint="Leave unassigned to use the default for the role.">
          <ModelSelect value={model} onChange={setModel} emptyLabel="Role default" />
        </Field>
        <Field label="Autonomy">
          <Select value={autonomy} onChange={(e) => setAutonomy(e.target.value as AutonomyLevel)}>
            {['Autonomous', 'Semi-Autonomous', 'Supervised', 'Shadowing'].map((a) => <option key={a}>{a}</option>)}
          </Select>
        </Field>
        <Field label="System prompt (optional)"><Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function OnboardInternDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const onboard = useAgentStore((s) => s.onboardIntern);
  const select = useAgentStore((s) => s.selectAgent);
  const seniors = mentorCandidates(agents);
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<string>('Frontend');
  const [customName, setCustomName] = useState('');
  const [baseRole, setBaseRole] = useState<AgentRole>('backend');
  const [focus, setFocus] = useState('');
  const [mentorId, setMentorId] = useState('');
  const [model, setModel] = useState('');
  const known = Array.from(new Set(Object.values(agents).map((a) => a.internship?.specialty).filter((s): s is string => !!s && !(BUILTIN_SPECIALTIES as readonly string[]).includes(s))));
  const specialty: InternSpecialty = choice === CUSTOM ? customName.trim() : choice;
  const isCustom = choice === CUSTOM;
  const suggested = suggestMentor(agents, specialty || 'Backend', isCustom ? baseRole : undefined);
  const mentor = mentorId || suggested;

  const submit = () => {
    const id = onboard({ name: name.trim(), specialty, mentorId: mentor, model: model || undefined, baseRole: isCustom ? baseRole : undefined, focus: focus.trim() || undefined });
    select(id);
    setName('');
    setCustomName('');
    setFocus('');
    setChoice('Frontend');
    setMentorId('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Onboard a junior agent" description="Junior output is reviewed by the mentor before it counts (N+1 review). It earns XP from reviewed work and graduates into a full specialist." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || !mentor || !specialty} onClick={submit}>Onboard</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Specialty">
            <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Specialty">
              {[...BUILTIN_SPECIALTIES, ...known].map((s) => <option key={s} value={s}>{s}</option>)}
              <option value={CUSTOM}>New specialty…</option>
            </Select>
          </Field>
          <Field label="Mentor (N+1 reviewer)" hint={mentor === suggested ? 'Suggested for this specialty' : undefined}>
            <Select value={mentor} onChange={(e) => setMentorId(e.target.value)} aria-label="Mentor">
              {seniors.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role === 'manager' ? 'direct manager' : a.specialty || a.title}</option>)}
            </Select>
          </Field>
        </div>
        {isCustom ? (
          <div className="space-y-3 rounded-md border border-line bg-surface-2 p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Specialty name"><Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. IoT & Embedded" /></Field>
              <Field label="Graduates into" hint="The role it takes on when it graduates.">
                <Select value={baseRole} onChange={(e) => setBaseRole(e.target.value as AgentRole)}>
                  {(['frontend', 'backend', 'qa', 'architect'] as AgentRole[]).map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="What should it study?" hint="Added to the agent's system prompt, so it studies and works on exactly this.">
              <Textarea rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Microcontrollers, firmware in C/C++ or Rust, MQTT, sensors, low-power design, OTA updates" />
            </Field>
          </div>
        ) : null}
        <Field label="Model"><ModelSelect value={model} onChange={setModel} emptyLabel="Role default" /></Field>
      </div>
    </Dialog>
  );
}
