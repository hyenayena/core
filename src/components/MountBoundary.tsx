import React, {Component, type ReactNode} from 'react';

type Props = {
	onError: (error: Error) => void;
	children: ReactNode;
};

export default class MountBoundary extends Component<Props, {failed: boolean}> {
	state = {failed: false};

	static getDerivedStateFromError() {
		return {failed: true};
	}

	componentDidCatch(error: unknown) {
		this.props.onError(error instanceof Error ? error : new Error(String(error)));
	}

	render() {
		return this.state.failed ? null : this.props.children;
	}
}
