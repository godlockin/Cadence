import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { NodeKindSchema } from '@cadence/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface PipelineNode {
  type: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface PipelineSection {
  nodes: PipelineNode[]
}

export interface PipelinePayload {
  input: PipelineSection
  inputValidate: PipelineSection
  process: PipelineSection
  resultValidate: PipelineSection
  postProcess: PipelineSection
  output: PipelineSection
}

export const PIPELINE_SECTION_KEYS = [
  'input',
  'inputValidate',
  'process',
  'resultValidate',
  'postProcess',
  'output',
] as const
export type PipelineSectionKey = (typeof PIPELINE_SECTION_KEYS)[number]

export const SECTION_LABELS: Record<PipelineSectionKey, string> = {
  input: 'Input',
  inputValidate: 'Input Validate',
  process: 'Process',
  resultValidate: 'Result Validate',
  postProcess: 'Post Process',
  output: 'Output',
}

const NODE_KINDS = NodeKindSchema.options as readonly string[]

function emptySection(): PipelineSection {
  return { nodes: [] }
}

export function emptyPipelinePayload(): PipelinePayload {
  return {
    input: emptySection(),
    inputValidate: emptySection(),
    process: emptySection(),
    resultValidate: emptySection(),
    postProcess: emptySection(),
    output: emptySection(),
  }
}

function isPipelinePayload(value: unknown): value is PipelinePayload {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return PIPELINE_SECTION_KEYS.every((key) => {
    const section = obj[key] as PipelineSection | undefined
    return (
      typeof section === 'object' &&
      section !== null &&
      Array.isArray(section.nodes) &&
      section.nodes.every(
        (n) =>
          typeof n === 'object' &&
          n !== null &&
          typeof (n as PipelineNode).type === 'string' &&
          typeof (n as PipelineNode).enabled === 'boolean',
      )
    )
  })
}

/** Validate a single node's config JSON. Empty object is treated as valid. */
export function validateNodeConfig(raw: string): { valid: boolean; message: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { valid: true, message: '' }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, message: 'Config must be a JSON object' }
    }
    return { valid: true, message: '' }
  } catch {
    return { valid: false, message: 'Invalid JSON' }
  }
}

function stringifyConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2)
}

interface NodeCardProps {
  index: number
  node: PipelineNode
  invalid: boolean
  invalidMessage: string
  onTypeChange: (type: string) => void
  onEnabledChange: (enabled: boolean) => void
  onConfigChange: (config: Record<string, unknown>) => void
  onRemove: () => void
}

function NodeCard({
  index,
  node,
  invalid,
  invalidMessage,
  onTypeChange,
  onEnabledChange,
  onConfigChange,
  onRemove,
}: NodeCardProps): React.ReactNode {
  const [configText, setConfigText] = useState<string>(() => stringifyConfig(node.config))

  const handleConfigBlur = (): void => {
    const { valid } = validateNodeConfig(configText)
    if (valid) {
      try {
        onConfigChange(JSON.parse(configText) as Record<string, unknown>)
      } catch {
        /* keep last valid */
      }
    }
  }

  const nodeCard = (
    <div
      className={cn(
        'space-y-3 rounded-lg border border-border bg-card p-4 transition-colors',
        invalid && 'border-red-500/70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">#{index + 1}</span>
          <Select value={node.type} onValueChange={onTypeChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NODE_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`enabled-${index}`} className="text-xs">
              Enabled
            </Label>
            <Switch
              id={`enabled-${index}`}
              checked={node.enabled}
              onCheckedChange={onEnabledChange}
            />
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Config (JSON)</Label>
        <Input
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          onBlur={handleConfigBlur}
          className={cn('font-mono text-xs', invalid && 'border-red-500/70')}
        />
        {invalid && <p className="text-xs text-red-500">{invalidMessage}</p>}
      </div>
    </div>
  )

  if (!invalid) return nodeCard
  return (
    <Tooltip>
      <TooltipTrigger asChild>{nodeCard}</TooltipTrigger>
      <TooltipContent>{invalidMessage}</TooltipContent>
    </Tooltip>
  )
}

interface SectionEditorProps {
  sectionKey: PipelineSectionKey
  section: PipelineSection
  invalidNodes: boolean[]
  invalidMessages: string[]
  onChange: (section: PipelineSection) => void
}

function SectionEditor({
  sectionKey,
  section,
  invalidNodes,
  invalidMessages,
  onChange,
}: SectionEditorProps): React.ReactNode {
  const [open, setOpen] = useState(sectionKey === 'input')

  const updateNode = (nodeIndex: number, patch: Partial<PipelineNode>): void => {
    const next = section.nodes.map((n, i) => (i === nodeIndex ? { ...n, ...patch } : n))
    onChange({ nodes: next })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {SECTION_LABELS[sectionKey]}
          <span className="text-xs text-muted-foreground">{section.nodes.length}</span>
        </span>
        {invalidNodes.some(Boolean) && (
          <span className="text-xs text-red-500">
            {invalidNodes.filter(Boolean).length} invalid
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-4">
          {section.nodes.map((node, nodeIndex) => (
            <NodeCard
              key={nodeIndex}
              index={nodeIndex}
              node={node}
              invalid={invalidNodes[nodeIndex] ?? false}
              invalidMessage={invalidMessages[nodeIndex] ?? ''}
              onTypeChange={(type) => updateNode(nodeIndex, { type })}
              onEnabledChange={(enabled) => updateNode(nodeIndex, { enabled })}
              onConfigChange={(config) => updateNode(nodeIndex, { config })}
              onRemove={() => onChange({ nodes: section.nodes.filter((_, i) => i !== nodeIndex) })}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                nodes: [...section.nodes, { type: 'transform', enabled: true, config: {} }],
              })
            }
          >
            <Plus className="h-4 w-4" /> Add node
          </Button>
        </div>
      )}
    </div>
  )
}

interface PipelineEditorProps {
  value: PipelinePayload
  onChange: (value: PipelinePayload) => void
  onValidityChange: (valid: boolean) => void
  defaultCollapsed?: boolean
}

export function PipelineEditor({
  value,
  onChange,
  onValidityChange,
  defaultCollapsed = true,
}: PipelineEditorProps): React.ReactNode {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const sections: Record<
    PipelineSectionKey,
    { invalidNodes: boolean[]; invalidMessages: string[] }
  > = useMemo(() => {
    const result = {} as Record<
      PipelineSectionKey,
      { invalidNodes: boolean[]; invalidMessages: string[] }
    >
    for (const key of PIPELINE_SECTION_KEYS) {
      const invalidNodes: boolean[] = []
      const invalidMessages: string[] = []
      for (const node of value[key].nodes) {
        const raw = stringifyConfig(node.config)
        const { valid, message } = validateNodeConfig(raw)
        invalidNodes.push(!valid)
        invalidMessages.push(message)
      }
      result[key] = { invalidNodes, invalidMessages }
    }
    return result
  }, [value])

  const anyInvalid = PIPELINE_SECTION_KEYS.some((key) => sections[key].invalidNodes.some(Boolean))
  useEffect(() => {
    onValidityChange(!anyInvalid)
  }, [anyInvalid, onValidityChange])

  const setSection = (key: PipelineSectionKey, section: PipelineSection): void => {
    onChange({ ...value, [key]: section })
  }

  const totalNodes = PIPELINE_SECTION_KEYS.reduce((sum, key) => sum + value[key].nodes.length, 0)

  // Summary mode
  if (collapsed) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
            <p className="font-medium">Pipeline Summary</p>
            <p className="text-sm text-muted-foreground">
              {PIPELINE_SECTION_KEYS.length} sections, {totalNodes} nodes
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setCollapsed(false)}>
            {totalNodes === 0 ? 'Configure' : 'Edit nodes'}
          </Button>
        </div>
        {anyInvalid && (
          <p className="text-sm text-destructive">
            {
              sections[
                PIPELINE_SECTION_KEYS.find((k) => sections[k].invalidNodes.some(Boolean)) ?? 'input'
              ].invalidNodes.filter(Boolean).length
            }{' '}
            node(s) have invalid config
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {PIPELINE_SECTION_KEYS.length} sections, {totalNodes} nodes configured
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed(true)}>
          Collapse
        </Button>
      </div>
      {PIPELINE_SECTION_KEYS.map((key) => (
        <SectionEditor
          key={key}
          sectionKey={key}
          section={value[key]}
          invalidNodes={sections[key].invalidNodes}
          invalidMessages={sections[key].invalidMessages}
          onChange={(section) => setSection(key, section)}
        />
      ))}
    </div>
  )
}

export { isPipelinePayload }
