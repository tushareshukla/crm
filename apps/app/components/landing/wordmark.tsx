import Logo from "@crm/ui/components/logo";
import LogoWordmark from "@crm/ui/components/logo-wordmark";
import { cn } from "@crm/ui/lib/utils";

export function Wordmark({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"flex shrink-0 select-none items-center gap-[9px] text-foreground",
				className,
			)}
		>
			<Logo className="size-[18px] shrink-0" />
			<LogoWordmark className="h-[15px] w-auto shrink-0" />
		</span>
	);
}
