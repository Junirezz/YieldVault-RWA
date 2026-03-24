import React, { createContext, useContext, useEffect, useState } from 'react';

interface VaultContextType {
    tvl: number;
    apy: number;
    formattedTvl: string;
    formattedApy: string;
    lastUpdate: Date;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

const BASE_TVL = 12450800;
const BASE_APY = 8.45;

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tvl, setTvl] = useState(BASE_TVL);
    const [apy, setApy] = useState(BASE_APY);
    const [lastUpdate, setLastUpdate] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => {
            // Simulate TVL fluctuation (between -500 and +1000)
            const fluctuation = (Math.random() * 1500) - 500;
            setTvl(prev => {
                const next = prev + fluctuation;
                // Keep it within a reasonable range of BASE_TVL
                if (next < BASE_TVL * 0.95 || next > BASE_TVL * 1.05) return prev;
                return next;
            });

            // Simulate minor APY fluctuation (+/- 0.01)
            setApy(prev => {
                const next = prev + (Math.random() * 0.02 - 0.01);
                return Math.max(5, Math.min(15, next));
            });

            setLastUpdate(new Date());
        }, 5000); // Update every 5 seconds

        return () => clearInterval(interval);
    }, []);

    const formattedTvl = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    }).format(tvl);

    const formattedApy = `${apy.toFixed(2)}%`;

    return (
        <VaultContext.Provider value={{ tvl, apy, formattedTvl, formattedApy, lastUpdate }}>
            {children}
        </VaultContext.Provider>
    );
};

export const useVault = () => {
    const context = useContext(VaultContext);
    if (!context) {
        throw new Error('useVault must be used within a VaultProvider');
    }
    return context;
};
