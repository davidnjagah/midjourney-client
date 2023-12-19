import jwt from 'jsonwebtoken';
import HttpError from '../models/errorModel';
import dotenv from 'dotenv';
dotenv.config();

interface Request {
    headers: {
        Authorization?: string;
        authorization?: string;
    };
    user?: jwt.JwtPayload | string;
}

interface Response {}

interface NextFunction {
    (error?: HttpError): void;
}

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const Authorization = req.headers.Authorization || req.headers.authorization;
    const PUB_KEY = process.env.JWT_SECRET;
    console.log("This is the PUB KEY", PUB_KEY);

    if (Authorization && Authorization.startsWith("Bearer")) {
        const token = Authorization.split(' ')[1];
        console.log(token);
        jwt.verify(token, PUB_KEY as string, (err, info) => {
            if (err) {
                console.error("JWT Verification Error:", err);
                return next(new HttpError("Unauthorized. Invalid Token.", 403));
            }

            req.user = info as jwt.JwtPayload;
            console.log("Decoded JWT:", info);
            next();
        });
    } else {
        return next(new HttpError("Unauthorized. No token", 401));
    }
};

export default authMiddleware;
