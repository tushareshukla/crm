"use client";

import Copy from "@carbon/icons-react/es/Copy";
import { Icon } from "@crm/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@crm/ui/components/input-group";
import { toast } from "sonner";

/** Copy `value` to the clipboard, telling the rep how it went. */
export function copyToClipboard(value: string, label: string): void {
	const unavailable = () =>
		toast.error(
			`Could not copy the ${label.toLowerCase()}. Select it instead.`,
		);

	const clipboard = navigator.clipboard;

	if (!clipboard) {
		unavailable();
		return;
	}

	clipboard
		.writeText(value)
		.then(() => toast.success(`${label} copied.`))
		.catch(unavailable);
}

/** A link shown read-only with a copy button beside it. */
export function CopyLink({
	value,
	label,
	id,
}: {
	value: string;
	label: string;
	id?: string;
}) {
	return (
		<InputGroup>
			<InputGroupInput
				id={id}
				value={value}
				readOnly
				className="font-mono text-xs"
				onFocus={(event) => event.currentTarget.select()}
				aria-label={label}
			/>
			<InputGroupAddon align="inline-end">
				<InputGroupButton
					size="icon-sm"
					onClick={() => copyToClipboard(value, label)}
				>
					<Icon icon={Copy} />
					<span className="sr-only">Copy {label.toLowerCase()}</span>
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}
