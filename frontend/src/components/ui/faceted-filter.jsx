"use client"

import * as React from "react"
import { Check, Filter } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function StatusFacetedFilter({
  title = "Status",
  value = "all",
  onChange,
  options = [],
}) {
  const [open, setOpen] = React.useState(false)
  const selectedOption = options.find((opt) => opt.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-dashed text-xs gap-1.5 font-normal bg-background"
        >
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{title}</span>
          {value !== "all" && (
            <>
              <Separator orientation="vertical" className="mx-1 h-3.5" />
              <Badge
                variant="secondary"
                className="rounded-sm px-1.5 font-normal text-[10px]"
              >
                {selectedOption?.label || value.toUpperCase()}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1 bg-popover border border-border shadow-md" align="start">
        <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
          Filter by {title}
        </div>
        <Separator className="my-1" />
        <div className="space-y-0.5">
          {options.map((opt) => {
            const isSelected = value === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-left cursor-pointer transition-colors outline-none",
                  isSelected
                    ? "bg-accent text-accent-foreground font-medium"
                    : "hover:bg-muted/70 text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded border",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input bg-background"
                    )}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </div>
                  <span>{opt.label}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {opt.count}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
