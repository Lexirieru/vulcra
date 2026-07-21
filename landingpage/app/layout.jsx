import './globals.css';

export const metadata = {
    title: 'Vulcra — Forge dollars from your XRP',
    description: 'Vulcra is a CDP stablecoin protocol on Flare. Deposit FXRP or wFLR to unlock vUSD dollars, or unlock them straight from XRPL in a single payment.',
    icons: {
        icon: '/favicon.svg',
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
