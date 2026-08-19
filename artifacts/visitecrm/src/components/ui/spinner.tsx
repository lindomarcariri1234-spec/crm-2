import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: Omit<React.SVGProps<SVGSVGElement>, "ref">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...(props as React.ComponentProps<typeof Loader2Icon>)}
    />
  )
}

export { Spinner }
